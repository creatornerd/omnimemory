import { findSimilar } from './duplicates';
import { findSensitive } from './sensitive';
import { normalizeText } from './text';
import { MAX_CONTENT_LENGTH, SITE_IDS, type Memory, type SiteId } from './types';

/**
 * Finding memories a chatbot already has that OmniMemory doesn't.
 *
 * Every sync reads what the chatbot remembers. This turns that into a review
 * checklist of short, first-person candidate memories. Nothing found here is
 * saved until the user approves it on the dashboard's Review page; approved
 * items become ordinary memories and then sync to every chatbot they're
 * shared with.
 *
 * Pure and offline: plain text rules, no AI.
 */

export interface FoundItem {
  /** Stable for the same text from the same chatbot. */
  id: string;
  site: SiteId;
  /** Where on the chatbot it came from (e.g. "Memory summary (written by ChatGPT)"). */
  source: string;
  /** Section or field name, when there is one. */
  title?: string;
  /** Suggested memory text (rephrased to first person where that's safe). */
  text: string;
  /** The chatbot's entry this came from, exactly as it had it. */
  original: string;
  /** The chatbot's id for the entry, so approving it doesn't add it there twice. */
  remoteId?: string;
  /** An existing memory this overlaps with or may contradict, shown as a warning. */
  conflictsWith?: string;
  /** Why: "Same topic, different numbers", "One says the opposite…", "Overlaps…". */
  conflictReason?: string;
  /** Other chatbots that remember the same thing (shown once, not once per chatbot). */
  alsoOn?: SiteId[];
}

/** Do two finds say the same thing? */
export function sameFind(a: string, b: string): boolean {
  return findSimilar(a, [{ id: 'x', content: b, status: 'active' } as Memory]).some((match) => match.kind === 'duplicate');
}

/**
 * The same fact found on several chatbots, shown once. The first copy that
 * can be linked back to its chatbot's entry (Gemini) is kept as the visible
 * one; the others ride along as its twins.
 */
export function groupFinds(items: FoundItem[]): { shown: FoundItem; twins: FoundItem[] }[] {
  const groups: { shown: FoundItem; twins: FoundItem[] }[] = [];
  for (const item of items) {
    const group = groups.find((existing) => existing.shown.site !== item.site && sameFind(existing.shown.text, item.text));
    if (!group) {
      groups.push({ shown: item, twins: [] });
      continue;
    }
    if (item.remoteId && !group.shown.remoteId) {
      group.twins.push(group.shown);
      group.shown = item;
    } else {
      group.twins.push(item);
    }
  }
  return groups.map(({ shown, twins }) => ({
    shown:
      twins.length > 0
        ? { ...shown, alsoOn: SITE_IDS.filter((site) => site !== shown.site && twins.some((twin) => twin.site === site)) }
        : shown,
    twins,
  }));
}

export interface DiscoverySource {
  /** An entry from the chatbot, as shown on the Chatbot memory page. */
  group: string;
  title?: string;
  text: string;
  remoteId?: string;
  /** Use the text as one memory instead of splitting it into sentences. */
  whole?: boolean;
}

export const MAX_FOUND = 200;
export const MAX_DISMISSED = 1000;
const MIN_WORDS = 3;

/** Short, stable hash (FNV-1a) used to recognise the same text again. */
export function textKey(text: string): string {
  let hash = 0x811c9dc5;
  const clean = normalizeText(text).replace(/[.!?。]+$/u, '');
  for (let index = 0; index < clean.length; index += 1) {
    hash ^= clean.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Split a paragraph into sentences, keeping things like "v5.1" or "e.g." intact. */
export function splitSentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z"“(])/u)
    .map((sentence) => sentence.replace(/^\s*(?:[-•*]|\d{1,2}[.)])\s+/, '').trim())
    .filter(Boolean);
}

/**
 * Chatbots write their memory as light Markdown: "## Interests",
 * "**Work context**", "- **Likes:** hiking". Drop heading-only lines and the
 * formatting marks, keep the words.
 */
export function stripMarkdown(text: string): string {
  return text
    .split(/\n/)
    .filter((line) => {
      const bare = line.trim();
      if (/^#{1,6}\s/.test(bare)) return false; // # Heading
      if (/^(?:\*\*|__)[^*_]+(?:\*\*|__):?$/.test(bare)) return false; // **Heading**
      if (/^(?:\*|_)[^*_]+(?:\*|_):?$/.test(bare)) return false; // *Heading*
      if (/^[-=*_]{3,}$/.test(bare)) return false; // --- rule
      return true;
    })
    .map((line) =>
      line
        .replace(/(\*\*|__)(.+?)\1/g, '$2')
        .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
        .replace(/`([^`]+)`/g, '$1'),
    )
    .join('\n');
}

/** Verbs a chatbot often starts a note with, leaving out "The user" ("Prefers short answers"). */
const LEADING_VERBS = new Set(
  (
    'prefers likes loves enjoys uses works lives wants needs plans studies owns speaks attends writes reads builds ' +
    'runs plays teaches follows values dislikes hates drives travels cooks goes takes knows believes tends codes ' +
    'programs develops creates manages leads practices learns keeps avoids eats drinks watches listens supports ' +
    'struggles hopes intends aims focuses specializes collaborates volunteers maintains'
  ).split(' '),
);

/**
 * The person a summary is about, when it's written in the third person by
 * name ("Sam is a nurse… Sam has a dog"). Needs the same capitalised word to
 * start at least two sentences followed by is/has/was/'s or a present-tense verb.
 */
export function summaryName(sentences: string[]): string | null {
  const counts = new Map<string, number>();
  for (const sentence of sentences) {
    const match = /^([A-Z][a-z]+(?:-[A-Z][a-z]+)?)(?:'s|’s|\s+(?:is|has|was|(\w+s))\b)/.exec(sentence.trim());
    if (!match) continue;
    const [, name, verb] = match;
    if (/^(?:The|This|That|These|Those|It|He|She|They|You|User|Users|There|Their|His|Her)$/.test(name)) continue;
    if (verb && !LEADING_VERBS.has(verb.toLowerCase())) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let best: string | null = null;
  let most = 1;
  for (const [name, count] of counts) {
    if (count > most) {
      best = name;
      most = count;
    }
  }
  return best;
}

/** "likes" → "like", "watches" → "watch", "studies" → "study". */
function baseVerb(verb: string): string {
  if (/ies$/i.test(verb)) return verb.slice(0, -3) + 'y';
  if (/(?:ss|x|z|ch|sh|o)es$/i.test(verb)) return verb.slice(0, -2);
  if (/ss$/i.test(verb)) return verb;
  return verb.slice(0, -1);
}

const OBJECT_AFTER = /\b(to|for|with|about|of|from|by|at|on|help|helps|give|gives|show|shows|tell|tells|let|lets)\s+you\b/gi;

/**
 * "You program VEX robots" → "I program VEX robots". Chatbots describe you in
 * the second person (or as "User …"); OmniMemory memories read as notes in
 * your own voice. Only common, unambiguous patterns are changed — the review
 * page lets the user fix anything else.
 */
export function toFirstPerson(sentence: string, name?: string | null): string {
  let out = sentence.trim();
  // "Sam is …", "Sam's …", "He has …": a summary about you, in the third person.
  const subject = name ? `(?:${name}|he|she)` : '(?:he|she)';
  out = out.replace(new RegExp(`^${subject}\\s+is\\b`, 'i'), 'I am');
  out = out.replace(new RegExp(`^${subject}\\s+has\\b`, 'i'), 'I have');
  out = out.replace(new RegExp(`^${subject}\\s+was\\b`, 'i'), 'I was');
  out = out.replace(new RegExp(`^${subject}\\s+does\\b`, 'i'), 'I do');
  if (name) out = out.replace(new RegExp(`^${name}(?:'s|’s)\\s`), 'My ');
  out = out.replace(/^(?:his|her)\s/i, 'My ');
  out = out.replace(new RegExp(`^${subject}\\s+(\\w+s)\\b(?=\\s)`, 'i'), (match, verb: string) =>
    LEADING_VERBS.has(verb.toLowerCase()) ? `I ${baseVerb(verb)}` : match,
  );
  if (name) out = out.replace(/\bhis\b/g, 'my');
  // "Prefers short answers", "Is learning C++": the subject was left out.
  out = out.replace(/^Is\b/, 'I am');
  out = out.replace(/^Has\b/, 'I have');
  out = out.replace(/^Was\b/, 'I was');
  out = out.replace(/^Does\b/, 'I do');
  out = out.replace(/^([A-Z][a-z]+s)\b(?=\s)/, (match, verb: string) =>
    LEADING_VERBS.has(verb.toLowerCase()) ? `I ${baseVerb(verb).toLowerCase()}` : match,
  );
  out = out.replace(/^(?:the\s+)?user\s+is\b/i, 'I am');
  out = out.replace(/^(?:the\s+)?user\s+has\b/i, 'I have');
  out = out.replace(/^(?:the\s+)?user\s+was\b/i, 'I was');
  out = out.replace(/^(?:the\s+)?user's\b/i, 'My');
  out = out.replace(/^(?:the\s+)?user\s+(\w+s)\b(?=\s)/i, (_m, verb: string) => `I ${baseVerb(verb)}`);
  out = out.replace(/^(?:the\s+)?user\s+/i, 'I ');

  const swaps: [RegExp, string][] = [
    [/\byou're\b/gi, "I'm"],
    [/\byou’re\b/gi, 'I’m'],
    [/\byou've\b/gi, "I've"],
    [/\byou’ve\b/gi, 'I’ve'],
    [/\byou'll\b/gi, "I'll"],
    [/\byou’ll\b/gi, 'I’ll'],
    [/\byou'd\b/gi, "I'd"],
    [/\byou’d\b/gi, 'I’d'],
    [/\byou are\b/gi, 'I am'],
    [/\byou were\b/gi, 'I was'],
    [/\byourself\b/gi, 'myself'],
    [/\byours\b/gi, 'mine'],
    [/\byour\b/gi, 'my'],
  ];
  for (const [pattern, replacement] of swaps) out = out.replace(pattern, replacement);
  out = out.replace(OBJECT_AFTER, (match) => match.replace(/you$/i, 'me'));
  out = out.replace(/\byou\b/gi, 'I');
  // "I play piano and is on a team" → "… and am on a team".
  if (/^I\s/i.test(out) && !/^I\s/.test(sentence.trim())) {
    out = out
      .replace(/\b(and|but|or)\s+is\b/g, '$1 am')
      .replace(/\b(and|but|or)\s+has\b/g, '$1 have')
      .replace(/\b(and|but|or)\s+was\b/g, '$1 was')
      .replace(/\b(and|but|or)\s+(\w+s)\b/g, (match, joiner: string, verb: string) =>
        LEADING_VERBS.has(verb.toLowerCase()) ? `${joiner} ${baseVerb(verb)}` : match,
      );
  }
  // Sentence starts with a capital; "my"/"me" mid-sentence stay lower-case.
  out = out.replace(/^(my|i'm|i’m|i've|i’ve|i'll|i’ll|i'd|i’d|i)\b/, (word) => word.charAt(0).toUpperCase() + word.slice(1));
  return out;
}

/**
 * AI-written summaries mix facts about you with remarks about your chats:
 * "you've asked for an explanation of PID tuning", "your robotics work is the
 * clearest area for tailoring explanations". Those aren't memories, and they
 * change wording every time the summary is rewritten, so they'd come back as
 * "new" forever. Drop them, and trim an "…, and you've asked about X" tail
 * off an otherwise good fact.
 */
const ABOUT_CHATS =
  /\b(?:tailor(?:ing|ed|s)?|supported area|clearest area|(?:previous|past|earlier|recent|our|these|those) (?:chats|conversations)|in (?:this|that|the|a) (?:chat|conversation)|evidence (?:suggests|shows)|based on (?:the|our|my|your) (?:chats|conversations))\b/i;
const ASKED = /^(?:(?:the )?user|i|you)(?:'ve|’ve|'d|’d| have| has| had)?\s+(?:also\s+|recently\s+|once\s+|previously\s+|often\s+)?(?:asked|requested|inquired|wanted to know|sought|looked up|searched)\b/i;
const ASKED_TAIL =
  /,?\s+(?:and|but)\s+(?:(?:the )?user|i|you)(?:'ve|’ve|'d|’d| have| has| had)?\s+(?:also\s+|recently\s+|once\s+)?(?:asked|requested|inquired|wanted to know)\b.*$/i;

/** The fact in a summary sentence, or null if it's only about past chats. */
export function factOnly(sentence: string): string | null {
  const original = sentence.trim();
  let text = original.replace(ASKED_TAIL, '').trim();
  if (!text || ASKED.test(text) || ABOUT_CHATS.test(text)) return null;
  if (text !== original && !/[.!?]$/.test(text)) text += '.';
  return text;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Turn one chatbot entry into candidate memory texts. */
export function candidatesFrom(source: DiscoverySource): string[] {
  const text = source.text.trim();
  if (!text) return [];

  if (source.title === 'Nickname') return [`Call me ${text.replace(/[.]+$/, '')}.`];
  if (source.title === 'Occupation') return [`My occupation: ${text}`];
  // Whole entries were saved on purpose, however short.
  if (source.whole) return [text];

  const firstPerson = /summary|saved memor|written by/i.test(source.group);
  const sentences = splitSentences(stripMarkdown(text));
  const name = firstPerson ? summaryName(sentences) : null;
  return sentences
    .map((sentence) => (firstPerson ? factOnly(toFirstPerson(sentence, name)) : sentence))
    .filter((sentence): sentence is string => sentence !== null && wordCount(sentence) >= MIN_WORDS);
}

/**
 * The review checklist for one chatbot: everything it remembers that isn't
 * already an OmniMemory memory and hasn't been skipped before.
 */
export function discover(
  site: SiteId,
  sources: DiscoverySource[],
  memories: Memory[],
  dismissed: string[],
): FoundItem[] {
  const existing = memories.filter((memory) => memory.status !== 'deleted');
  // Deleted on purpose: don't offer it back just because the chatbot still remembers it.
  const deleted = memories.filter((memory) => memory.status === 'deleted').map((memory) => ({ ...memory, status: 'active' as const }));
  const skipped = new Set(dismissed);
  const seen = new Set<string>();
  const found: FoundItem[] = [];
  // Earlier finds in this same scan, so near-repeats inside one summary count once.
  const accepted: Memory[] = [];

  for (const source of sources) {
    for (const candidate of candidatesFrom(source)) {
      const text = candidate.slice(0, MAX_CONTENT_LENGTH).trim();
      const key = textKey(text);
      if (!text || seen.has(key) || skipped.has(key)) continue;
      seen.add(key);
      if (findSensitive(text).length > 0) continue;

      const similar = findSimilar(text, existing);
      if (similar.some((match) => match.kind === 'duplicate')) continue;
      if (findSimilar(text, deleted).some((match) => match.kind === 'duplicate')) continue;
      if (findSimilar(text, accepted).some((match) => match.kind === 'duplicate')) continue;
      const conflict = similar.find((match) => match.kind === 'conflict');
      accepted.push({ id: `found-${key}`, content: text, status: 'active' } as Memory);

      found.push({
        id: `${site}-${key}`,
        site,
        source: source.group,
        title: source.title,
        text,
        original: source.text,
        remoteId: source.remoteId,
        conflictsWith: conflict?.memory.content,
        conflictReason: conflict?.reason,
      });
      if (found.length >= MAX_FOUND) return found;
    }
  }
  return found;
}
