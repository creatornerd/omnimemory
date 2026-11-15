import type { OpResult, RemoteSnapshot, SyncOp } from '../../core/sync';
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
const MAX_PAGES = 5;

interface Tokens {
  at: string;
  sid: string;
  bl: string;
}

let tokens: Tokens | null = null;
let requestCounter = Math.floor(Math.random() * 9000) + 1000;

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
  if (tokens && !fresh) return tokens;
  // Gemini puts them in an inline <script> on every page.
  if (!fresh) {
    for (const script of document.querySelectorAll('script')) {
      const text = script.textContent ?? '';
      if (!text.includes('SNlM0e')) continue;
      const found = tokensFrom(text);
      if (found) return (tokens = found);
    }
  }
  // A long-lived tab may hold stale ones; the app page always has fresh ones.
  const page = await siteRequest('/app');
  const found = page.ok ? tokensFrom(await page.text()) : null;
  if (!found) throw new SyncError('Sign in to Gemini to sync your memories.');
  return (tokens = found);
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

async function call(rpcId: string, payload: unknown, retry = true): Promise<unknown> {
  const { at, sid, bl } = await getTokens(!retry);
  requestCounter += 100000;
  const query = new URLSearchParams({
    rpcids: rpcId,
    'source-path': '/app',
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
  const response = await siteRequest(`/_/BardChatUi/data/batchexecute?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Same-Domain': '1' },
    body,
  });
  if ((response.status === 400 || response.status === 401 || response.status === 403) && retry) {
    // Usually an expired token: fetch fresh ones once and try again.
    return call(rpcId, payload, false);
  }
  if (!response.ok) {
    throw new SyncError(
      response.status === 401 || response.status === 403
        ? 'Sign in to Gemini to sync your memories.'
        : `Gemini returned an error (${response.status}).`,
    );
  }
  return parseBatchResponse(await response.text(), rpcId);
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
    const result = await call(RPC.list, pageToken ? [PAGE_SIZE, pageToken] : [PAGE_SIZE]);
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
  async read(): Promise<RemoteSnapshot> {
    return { managed: await listAll(), readOnly: [] };
  },

  async apply(op: SyncOp): Promise<OpResult> {
    try {
      switch (op.op) {
        case 'create': {
          const entry = savedEntry(await call(RPC.create, [[null, op.text]]));
          await wait(250);
          return { ok: true, remoteId: entry.id, remoteText: entry.text };
        }
        case 'update': {
          const entry = savedEntry(await call(RPC.update, [[op.remoteId, op.text], [['text']]]));
          await wait(250);
          return { ok: true, remoteId: entry.id, remoteText: entry.text };
        }
        case 'delete':
          await call(RPC.remove, [op.remoteId]);
          await wait(250);
          return { ok: true };
        default:
          return { ok: false, error: 'Gemini doesn’t support this change.' };
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Gemini refused this change.' };
    }
  },
};
