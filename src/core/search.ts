import { canonical, contentTokens, editDistance, normalizeText, rawTokens, stem } from './text';
import type { Memory } from './types';

/**
 * Search and retrieval. Two entry points:
 *
 *  - searchMemories: what the user types into a search box. Every term must
 *    match (prefix-friendly, so results narrow as you type).
 *  - rankByRelevance: free text (a draft message, the tail of a conversation)
 *    scored against memories with IDF weighting. Any overlap counts.
 *
 * Both are pure functions over an array. Callers are responsible for passing
 * only the memories that are allowed to be seen (see permissions.ts) — that
 * way deleted or unshared memories cannot leak through a search path.
 *
 * A future version can swap rankByRelevance for embeddings without touching
 * callers: the signature is "memories + text in, scored memories out".
 */

interface IndexedMemory {
  memory: Memory;
  text: string;
  tokens: string[];
  stems: Set<string>;
  /** Stems with synonyms folded together ("brief" → "short"). */
  groups: Set<string>;
  tagTokens: Set<string>;
}

function indexMemory(memory: Memory): IndexedMemory {
  const tagText = memory.tags.join(' ');
  const text = normalizeText(`${memory.content} ${tagText} ${memory.category} ${memory.source}`);
  const tokens = rawTokens(text);
  return {
    memory,
    text,
    tokens,
    stems: new Set(tokens.map(stem)),
    groups: new Set(tokens.map((token) => canonical(stem(token)))),
    tagTokens: new Set(rawTokens(tagText)),
  };
}

function termScore(entry: IndexedMemory, term: string): number {
  let best = 0;
  if (entry.tokens.includes(term)) best = 3;
  else if (entry.stems.has(stem(term))) best = 2.5;
  else if (entry.tokens.some((token) => token.startsWith(term))) best = 2;
  else if (term.length >= 3 && entry.text.includes(term)) best = 1;
  else if (term.length >= 4 && entry.groups.has(canonical(stem(term)))) best = 1.8; // a synonym
  else if (term.length >= 5) {
    // A typo: "robtics" still finds "robotics".
    const allowed = term.length >= 8 ? 2 : 1;
    if (entry.tokens.some((token) => token.length >= 4 && editDistance(term, token, allowed) <= allowed)) best = 1.2;
  }
  if (best > 0 && [...entry.tagTokens].some((tag) => tag.startsWith(term))) best *= 1.5;
  return best;
}

/** Instant search. Empty query returns the input unchanged. */
export function searchMemories(memories: Memory[], query: string): Memory[] {
  const terms = rawTokens(query);
  if (terms.length === 0) return memories;
  const phrase = normalizeText(query);

  const scored: { memory: Memory; score: number }[] = [];
  for (const memory of memories) {
    const entry = indexMemory(memory);
    let score = 0;
    let matchedAll = true;
    for (const term of terms) {
      const s = termScore(entry, term);
      if (s === 0) {
        matchedAll = false;
        break;
      }
      score += s;
    }
    if (!matchedAll) continue;
    if (terms.length > 1 && entry.text.includes(phrase)) score += 2;
    scored.push({ memory, score });
  }

  scored.sort(
    (a, b) => b.score - a.score || b.memory.updated_at.localeCompare(a.memory.updated_at),
  );
  return scored.map((s) => s.memory);
}

export interface RelevanceResult {
  memory: Memory;
  score: number;
  /** True when the overlap is strong enough to suggest the memory unprompted. */
  relevant: boolean;
}

/** Rank memories against free text. Order: score desc, then most recently updated. */
export function rankByRelevance(memories: Memory[], text: string): RelevanceResult[] {
  const queryTokens = new Set(contentTokens(text));
  const docs = memories.map((memory) => ({
    memory,
    tokens: new Set(contentTokens(`${memory.content} ${memory.tags.join(' ')}`)),
  }));

  const documentFrequency = new Map<string, number>();
  for (const doc of docs) {
    for (const token of doc.tokens) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  const idf = (token: string) =>
    Math.log(1 + docs.length / (documentFrequency.get(token) ?? 1));

  const results: RelevanceResult[] = docs.map(({ memory, tokens }) => {
    if (queryTokens.size === 0 || tokens.size === 0) return { memory, score: 0, relevant: false };
    let matchedWeight = 0;
    let totalWeight = 0;
    let matchedCount = 0;
    for (const token of tokens) {
      const weight = idf(token);
      totalWeight += weight;
      if (queryTokens.has(token)) {
        matchedWeight += weight;
        matchedCount += 1;
      }
    }
    const coverage = totalWeight > 0 ? matchedWeight / totalWeight : 0;
    return {
      memory,
      score: matchedWeight * (0.5 + coverage),
      relevant: matchedCount >= 2 || coverage >= 0.25,
    };
  });

  results.sort(
    (a, b) => b.score - a.score || b.memory.updated_at.localeCompare(a.memory.updated_at),
  );
  return results;
}
