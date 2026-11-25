import { sameMeaning, type OpResult, type RemoteSnapshot, type SyncOp } from '../../core/sync';
import { send } from '../bridge';
import { SyncError, siteRequest, wait } from './http';
import type { MemorySyncAdapter } from './types';

/**
 * Gemini → Settings → "Instructions for Gemini" (formerly "Saved info").
 *
 * Gemini's web app talks to its server through Google's batchexecute
 * endpoint. These are the four calls its own settings page uses; the names
 * come from Gemini's code (BardFrontendService.*Memories):
 *
 *   ZKcapf  ListMemories   [pageSize, pageToken?]   → [[entry…], nextPageToken]
 *   xVRQX   CreateMemory   [[null, text]]           → [_, _, _, [[entry]]]
 *   gSnMcd  UpdateMemory   [[id, text], [["text"]]] → [_, _, _, [[entry]]]
 *   Ok9j9b  DeleteMemory   [id]                     → []
 *
 * where entry = [id, text, createdAt, _, updatedAt, …]. Requests need the
 * page's anti-forgery token, which Gemini embeds in the page itself.
 */

const RPC = {
  list: 'ZKcapf',
  create: 'xVRQX',
  update: 'gSnMcd',
  remove: 'Ok9j9b',
} as const;

const PAGE_SIZE = 100;
/** Pause between changes, so a long list doesn't trip Gemini's rate limit. */
const PAUSE_MS = 350;
const MAX_PAGES = 5;

interface Tokens {
  at: string;
  sid: string;
  bl: string;
}


let tokens: { prefix: string; value: Tokens } | null = null;
let requestCounter = Math.floor(Math.random() * 9000) + 1000;

/**
 * Gemini serves a second (third…) signed-in Google account under /u/1/,
 * /u/2/… Requests must go to the same account the page is using, or they
 * fail (or, worse, reach the first account).
 */
export function accountPrefix(pathname: string): string {
  return /^\/u\/\d{1,2}(?=\/|$)/.exec(pathname)?.[0] ?? '';
}

function pick(source: string, key: string): string | null {
  const match = source.match(new RegExp(`"${key}":"([^"]+)"`));
  return match ? match[1] : null;
}

function tokensFrom(source: string): Tokens | null {
  const at = pick(source, 'SNlM0e');
  const sid = pick(source, 'FdrFJe');
  const bl = pick(source, 'cfb2h');
  return at && sid && bl ? { at, sid, bl } : null;
}

async function getTokens(fresh = false): Promise<Tokens> {
  const prefix = accountPrefix(window.location.pathname);
  if (tokens && tokens.prefix === prefix && !fresh) return tokens.value;
  // Gemini puts them in an inline <script> on every page.
  if (!fresh) {
    for (const script of document.querySelectorAll('script')) {
      const text = script.textContent ?? '';
      if (!text.includes('SNlM0e')) continue;
      const found = tokensFrom(text);
      if (found) return (tokens = { prefix, value: found }).value;
    }
  }
  // A long-lived tab may hold stale ones; the app page always has fresh ones.
  const page = await siteRequest(`${prefix}/app`).catch(() => null);
  const found = page?.ok ? tokensFrom(await page.text()) : null;
  if (!found) throw new SyncError('Sign in to Gemini to sync your memories.');
  return (tokens = { prefix, value: found }).value;
}

/** Pull the result of one call out of a batchexecute response. */
export function parseBatchResponse(body: string, rpcId: string): unknown {
  for (const line of body.split('\n')) {
    if (!line.startsWith('[')) continue;
    let chunk: unknown;
    try {
      chunk = JSON.parse(line);
    } catch {
      continue;
    }
    if (!Array.isArray(chunk)) continue;
    for (const entry of chunk) {
      if (!Array.isArray(entry) || entry[0] !== 'wrb.fr' || entry[1] !== rpcId) continue;
      if (typeof entry[2] !== 'string') throw new SyncError('Gemini didn’t accept this change.');
      return JSON.parse(entry[2]);
    }
  }
  throw new SyncError('Gemini sent an unexpected reply.');
}

/** Waits before retrying a request that hit a passing problem. */
const RETRY_WAITS = [1000, 3000];

interface CallOptions {
  /**
   * May the same request be sent again after a network error or a server
   * error? Not for "create": Gemini may have saved it already.
   */
  repeatable: boolean;
}

async function call(rpcId: string, payload: unknown, options: CallOptions, attempt = 0, fresh = false): Promise<unknown> {
  const { at, sid, bl } = await getTokens(fresh);
  const prefix = accountPrefix(window.location.pathname);
  requestCounter += 100000;
  const query = new URLSearchParams({
    rpcids: rpcId,
    'source-path': `${prefix}/app`,
    bl,
    'f.sid': sid,
    hl: document.documentElement.lang || 'en',
    _reqid: String(requestCounter),
    rt: 'c',
  });
  const body = new URLSearchParams({
    'f.req': JSON.stringify([[[rpcId, JSON.stringify(payload), null, 'generic']]]),
    at,
  });
  const retry = async (factor = 1) => {
    await wait(RETRY_WAITS[attempt] * factor);
    return call(rpcId, payload, options, attempt + 1, fresh);
  };

  let response: Response;
  try {
    response = await siteRequest(`${prefix}/_/BardChatUi/data/batchexecute?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Same-Domain': '1' },
      body,
    });
  } catch {
    if (options.repeatable && attempt < RETRY_WAITS.length) return retry();
    throw new SyncError('Couldn’t reach Gemini. Check your connection; OmniMemory will try again later.');
  }

  // Usually an expired token. Nothing was changed, so asking again is safe.
  if ((response.status === 400 || response.status === 401 || response.status === 403) && !fresh) {
    return call(rpcId, payload, options, attempt, true);
  }
  // Busy or a passing server problem: wait a moment and ask again.
  if (response.status === 429 && attempt < RETRY_WAITS.length) return retry(2);
  if (response.status >= 500 && options.repeatable && attempt < RETRY_WAITS.length) return retry();
  if (!response.ok) {
    throw new SyncError(
      response.status === 401 || response.status === 403
        ? 'Sign in to Gemini to sync your memories.'
        : response.status === 429
          ? 'Gemini is busy right now. OmniMemory will try again later.'
          : `Gemini returned an error (${response.status}). OmniMemory will try again later.`,
    );
  }
  const text = await response.text();
  try {
    return parseBatchResponse(text, rpcId);
  } catch (error) {
    // An odd reply to a read is usually a stale token: try once with fresh ones.
    if (options.repeatable && !fresh) return call(rpcId, payload, options, attempt, true);
    throw error;
  }
}

function entryFrom(raw: unknown): { id: string; text: string } | null {
  if (!Array.isArray(raw) || typeof raw[0] !== 'string' || typeof raw[1] !== 'string') return null;
  return { id: raw[0], text: raw[1] };
}

/** The saved entry a create/update call returns. */
function savedEntry(result: unknown): { id: string; text: string } {
  const entry = Array.isArray(result) && Array.isArray(result[3]) && Array.isArray(result[3][0])
    ? entryFrom(result[3][0][0])
    : null;
  if (!entry) throw new SyncError('Gemini didn’t save this memory. It may not accept this kind of text.');
  return entry;
}

async function listAll(): Promise<{ id: string; text: string }[]> {
  const items: { id: string; text: string }[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await call(RPC.list, pageToken ? [PAGE_SIZE, pageToken] : [PAGE_SIZE], { repeatable: true });
    const rows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : [];
    for (const row of rows) {
      const entry = entryFrom(row);
      if (entry) items.push(entry);
    }
    pageToken = Array.isArray(result) && typeof result[1] === 'string' && result[1] ? result[1] : null;
    if (!pageToken) break;
  }
  return items;
}

export const geminiSync: MemorySyncAdapter = {
  async read({ cache }): Promise<RemoteSnapshot> {
    const managed = await listAll();
    // Remember which Google account Gemini is used with, so a background
    // sync tab opens that one rather than the first signed-in account.
    const prefix = accountPrefix(window.location.pathname);
    if ((cache.account ?? '') !== prefix) {
      await send({ type: 'sync/cache', key: 'account', value: prefix }).catch(() => {});
    }
    return { managed, readOnly: [] };
  },

  async apply(op: SyncOp): Promise<OpResult> {
    try {
      switch (op.op) {
        case 'create': {
          let entry: { id: string; text: string } | null = null;
          try {
            entry = savedEntry(await call(RPC.create, [[null, op.text]], { repeatable: false }));
          } catch (error) {
            // Gemini may have saved it even though the reply went wrong. Look
            // before reporting a failure, or the next sync adds a second copy.
            await wait(600);
            entry = (await listAll().catch(() => [])).find((item) => sameMeaning(item.text, op.text)) ?? null;
            if (!entry) throw error;
          }
          await wait(PAUSE_MS);
          return { ok: true, remoteId: entry.id, remoteText: entry.text };
        }
        case 'update': {
          try {
            const entry = savedEntry(await call(RPC.update, [[op.remoteId, op.text], [['text']]], { repeatable: true }));
            await wait(PAUSE_MS);
            return { ok: true, remoteId: entry.id, remoteText: entry.text };
          } catch (error) {
            // The change may have gone through anyway.
            const entry = (await listAll().catch(() => [])).find((item) => item.id === op.remoteId);
            if (entry && sameMeaning(entry.text, op.text)) return { ok: true, remoteId: entry.id, remoteText: entry.text };
            throw error;
          }
        }
        case 'delete':
          try {
            await call(RPC.remove, [op.remoteId], { repeatable: true });
          } catch (error) {
            // Gone is gone, whatever Gemini replied.
            const still = await listAll()
              .then((items) => items.some((item) => item.id === op.remoteId))
              .catch(() => true);
            if (still) throw error;
          }
          await wait(PAUSE_MS);
          return { ok: true };
        default:
          return { ok: false, error: 'Gemini doesn’t support this change.' };
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Gemini refused this change.' };
    }
  },
};
