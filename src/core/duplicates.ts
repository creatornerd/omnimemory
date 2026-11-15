import { contentTokens, normalizeText, rawTokens } from './text';
import type { Memory } from './types';

/**
 * Heuristic duplicate / conflict detection — no AI, no network.
 *
 *  - duplicate: says the same thing (near-identical wording)
 *  - conflict:  talks about the same thing but differs (a changed number, a
 *               negation, or substantial but partial overlap)
 *
 * Results are only ever used to warn the user. Nothing is merged, skipped or
 * overwritten automatically.
 */

export type MatchKind = 'duplicate' | 'conflict';

export interface SimilarMatch {
  memory: Memory;
  kind: MatchKind;
  similarity: number;
  reason: string;
}

const DUPLICATE_THRESHOLD = 0.82;
const CONFLICT_THRESHOLD = 0.5;

const NEGATIONS = new Set([
  'not', 'no', 'never', "don't", 'dont', "doesn't", 'doesnt', "isn't", 'isnt', "can't", 'cant',
  'cannot', 'longer', 'stopped', 'quit', 'dislike', 'dislikes', 'hate', 'hates', 'avoid', 'avoids',
]);

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function hasNegation(text: string): boolean {
  return normalizeText(text)
    .split(/[^\p{L}']+/u)
    .some((word) => NEGATIONS.has(word));
}

function numbers(text: string): string[] {
  return rawTokens(text).filter((token) => /^\d/.test(token)).sort();
}

/** Similarity in [0, 1] between two pieces of memory text. */
export function similarity(a: string, b: string): number {
  if (normalizeText(a) === normalizeText(b)) return 1;
  return jaccard(new Set(contentTokens(a)), new Set(contentTokens(b)));
}

function classify(a: string, b: string): { kind: MatchKind; similarity: number; reason: string } | null {
  const score = similarity(a, b);
  if (score < CONFLICT_THRESHOLD) return null;

  if (hasNegation(a) !== hasNegation(b)) {
    return { kind: 'conflict', similarity: score, reason: 'One says the opposite of the other' };
  }
  const numbersA = numbers(a);
  const numbersB = numbers(b);
  if ((numbersA.length > 0 || numbersB.length > 0) && numbersA.join(',') !== numbersB.join(',')) {
    return { kind: 'conflict', similarity: score, reason: 'Same topic, different numbers' };
  }
  if (score >= DUPLICATE_THRESHOLD) {
    return {
      kind: 'duplicate',
      similarity: score,
      reason: normalizeText(a) === normalizeText(b) ? 'Identical wording' : 'Nearly identical wording',
    };
  }
  return { kind: 'conflict', similarity: score, reason: 'Overlaps with an existing memory' };
}

/**
 * Compare candidate text with existing memories. Trashed memories are ignored;
 * `excludeId` skips the memory being edited.
 */
export function findSimilar(content: string, existing: Memory[], excludeId?: string): SimilarMatch[] {
  const matches: SimilarMatch[] = [];
  for (const memory of existing) {
    if (memory.id === excludeId || memory.status === 'deleted') continue;
    const result = classify(content, memory.content);
    if (result) matches.push({ memory, ...result });
  }
  matches.sort((a, b) => b.similarity - a.similarity);
  return matches;
}

/** Groups of memories that duplicate one another, for the "review duplicates" view. */
export function findDuplicateGroups(memories: Memory[]): Memory[][] {
  const live = memories.filter((memory) => memory.status !== 'deleted');
  const parent = new Map<string, string>(live.map((memory) => [memory.id, memory.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };

  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      const result = classify(live[i].content, live[j].content);
      if (result?.kind === 'duplicate') parent.set(find(live[i].id), find(live[j].id));
    }
  }

  const groups = new Map<string, Memory[]>();
  for (const memory of live) {
    const root = find(memory.id);
    groups.set(root, [...(groups.get(root) ?? []), memory]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}
