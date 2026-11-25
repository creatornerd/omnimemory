/** Text normalisation shared by search, relevance ranking and duplicate detection. */

const STOPWORDS = new Set(
  `a an and are as at be been but by can could did do does for from had has have he her his how i if in into is it its
   me my of on or our she so than that the their them then there these they this to was we were what when where which
   who why will with would you your user users likes like prefers prefer uses use using also very really just about
   not no`.split(/\s+/),
);

/** Lowercase, strip diacritics, collapse whitespace. */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Very light stemming: enough to match "robots"/"robot", "coding"/"code". */
export function stem(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith('ing') && token.length > 5) return token.slice(0, -3);
  if (token.endsWith('ed') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('es') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  if (token.endsWith('e') && token.length > 4) return token.slice(0, -1);
  return token;
}

/** Split into word tokens. Keeps things like "c++", "c#", "node.js" readable. */
export function rawTokens(input: string): string[] {
  return normalizeText(input).match(/[\p{L}\p{N}][\p{L}\p{N}+#]*/gu) ?? [];
}

/** Tokens for ranking: stemmed, stopwords removed. */
export function contentTokens(input: string): string[] {
  const out: string[] = [];
  for (const token of rawTokens(input)) {
    if (STOPWORDS.has(token)) continue;
    out.push(stem(token));
  }
  return out;
}

export function isStopword(token: string): boolean {
  return STOPWORDS.has(token);
}

/**
 * Words that mean the same for memory purposes. Search uses them so
 * "concise" finds "short, direct answers"; duplicate checks use them so
 * "I prefer brief replies" and "I prefer short answers" count as one.
 * Each group is matched on stems; the first word is the group's name.
 */
const SYNONYM_GROUPS: string[][] = [
  ['short', 'concise', 'brief', 'succinct', 'terse', 'direct', 'compact', 'quick'],
  ['detail', 'detailed', 'thorough', 'comprehensive', 'depth', 'elaborate', 'extensive'],
  ['answer', 'answers', 'reply', 'replies', 'response', 'responses', 'explanation', 'explanations'],
  ['job', 'work', 'career', 'occupation', 'profession', 'employed'],
  ['kid', 'kids', 'child', 'children', 'son', 'daughter', 'sons', 'daughters'],
  ['code', 'coding', 'program', 'programming', 'programmer', 'developer', 'develop', 'software'],
  ['enjoy', 'love', 'favorite', 'favourite', 'fan', 'into'],
  ['dislike', 'hate', 'avoid', 'detest'],
  ['live', 'reside', 'based', 'located'],
  ['study', 'student', 'school', 'studying', 'learn', 'learning'],
  ['speak', 'language', 'fluent'],
  ['vegetarian', 'veggie'],
  ['photo', 'photography', 'photograph', 'photographer', 'camera'],
  ['coach', 'coaching', 'coaches', 'trainer'],
];

const CANONICAL = new Map<string, string>();
for (const group of SYNONYM_GROUPS) {
  const head = stem(group[0]);
  for (const word of group) CANONICAL.set(stem(word), head);
}

/** The synonym group a stemmed token belongs to, or the token itself. */
export function canonical(stemmed: string): string {
  return CANONICAL.get(stemmed) ?? stemmed;
}

/** Content tokens with synonyms folded together. */
export function canonicalTokens(input: string): string[] {
  return contentTokens(input).map(canonical);
}

/** Edit distance, giving up (returning max + 1) once it's clearly too far. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      best = Math.min(best, current[j]);
    }
    if (best > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
}
