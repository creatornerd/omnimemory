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
