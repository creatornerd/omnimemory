import { findSimilar } from './duplicates';
import { findSensitive } from './sensitive';
import { normalizeText } from './text';
import { MAX_CONTENT_LENGTH, type Memory, type SiteId } from './types';

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
    .map((sentence) => sentence.replace(/^\s*[-•*]\s+/, '').trim())
    .filter(Boolean);
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
export function toFirstPerson(sentence: string): string {
  let out = sentence.trim();
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
  return splitSentences(text)
    .map((sentence) => (firstPerson ? factOnly(toFirstPerson(sentence)) : sentence))
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
