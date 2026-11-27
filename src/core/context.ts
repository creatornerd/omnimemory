import type { Memory } from './types';

export const CONTEXT_HEADER =
  '[Context about me, shared from my OmniMemory. Use it where relevant; no need to mention it.]';
export const CONTEXT_FOOTER = '[End of context]';

/** Soft cap so an inserted context never dwarfs the user's own message. */
export const MAX_CONTEXT_CHARS = 6000;

export interface BuiltContext {
  text: string;
  /** Ids actually included (some may be dropped to respect the size cap). */
  includedIds: string[];
  truncated: boolean;
}

/**
 * Turn approved memories into the plain-text block that is inserted into (or
 * copied for) a chatbot. Plain text only: the result is always written as a
 * text node / clipboard string, never interpreted as HTML.
 */
export function buildContext(memories: Memory[]): BuiltContext {
  const lines: string[] = [];
  const includedIds: string[] = [];
  let used = CONTEXT_HEADER.length + CONTEXT_FOOTER.length;
  let truncated = false;

  for (const memory of memories) {
    const line = `- ${memory.content.replace(/\s*\n\s*/g, ' ').trim()}`;
    if (used + line.length + 1 > MAX_CONTEXT_CHARS) {
      truncated = true;
      break;
    }
    lines.push(line);
    includedIds.push(memory.id);
    used += line.length + 1;
  }

  if (lines.length === 0) return { text: '', includedIds: [], truncated };
  return {
    text: [CONTEXT_HEADER, ...lines, CONTEXT_FOOTER].join('\n'),
    includedIds,
    truncated,
  };
}

/** The text with any OmniMemory context block taken out (so it isn't matched against itself). */
export function withoutContext(text: string): string {
  let out = text;
  for (;;) {
    const start = out.indexOf(CONTEXT_HEADER);
    if (start < 0) return out;
    const end = out.indexOf(CONTEXT_FOOTER, start);
    out = end < 0 ? out.slice(0, start) : `${out.slice(0, start)} ${out.slice(end + CONTEXT_FOOTER.length)}`;
  }
}
