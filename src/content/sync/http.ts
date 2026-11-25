/**
 * The only network access in OmniMemory.
 *
 * Used solely to keep a chatbot's own memory feature in step with OmniMemory
 * (see core/sync.ts). Requests go to the chatbot site the content script is
 * already running on — the same requests that site's own settings page
 * makes — and nowhere else. Anything that is not a same-origin path is refused.
 */
export async function siteRequest(path: string, init: RequestInit = {}): Promise<Response> {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('OmniMemory only talks to the chatbot site itself.');
  }
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin) {
    throw new Error('OmniMemory only talks to the chatbot site itself.');
  }
  // Firefox gives content scripts a `content` object whose fetch runs as the
  // page itself (so the site sees its own origin). Chrome already does that.
  const page = (globalThis as { content?: { fetch?: typeof fetch } }).content;
  const scope = typeof page?.fetch === 'function' ? (page as { fetch: typeof fetch }) : globalThis;
  return scope.fetch(url.toString(), { ...init, credentials: 'same-origin', cache: 'no-store' });
}

export class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncError';
  }
}

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
