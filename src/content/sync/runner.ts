import type { OpResult, RemoteSnapshot } from '../../core/sync';
import type { SiteId } from '../../core/types';
import { send } from '../bridge';
import { chatgptSync } from './chatgpt';
import { claudeSync } from './claude';
import { geminiSync } from './gemini';
import { wait } from './http';
import type { MemorySyncAdapter } from './types';

const ADAPTERS: Partial<Record<SiteId, MemorySyncAdapter>> = {
  chatgpt: chatgptSync,
  claude: claudeSync,
  gemini: geminiSync,
};

/** Re-read the chatbot's memory at least this often while a tab is open. */
const REFRESH_EVERY_MS = 15 * 60 * 1000;

let running = false;
let again: { refresh: boolean } | null = null;
let retry: { refresh: boolean; attempt: number } | null = null;

function hasRuntime(): boolean {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : 'Sync failed.').slice(0, 280);
}

/** Another tab is mid-sync: wait for it this many times before giving up. */
const BUSY_RETRIES = 16;
const BUSY_WAIT_MS = 5000;

async function run(site: SiteId, adapter: MemorySyncAdapter, refresh: boolean, attempt = 0): Promise<void> {
  if (running) {
    again = { refresh: refresh || (again?.refresh ?? false) };
    return;
  }
  running = true;
  let planId: string | null = null;
  try {
    const status = await send({ type: 'sync/status' });
    if (status.blocked) return;
    // "Sync now" pressed while no tab was open: this tab was opened for it,
    // and the request may have arrived before this script did.
    if (status.cache.requested) refresh = true;
    const stale = !status.lastSyncAt || Date.now() - Date.parse(status.lastSyncAt) > REFRESH_EVERY_MS;
    if (!refresh && status.pending === 0 && !stale) return;

    const remote = await adapter.read({ refresh, light: false, cache: status.cache });
    const begin = await send({ type: 'sync/begin', remote });
    if (begin.status === 'busy' && attempt < BUSY_RETRIES) {
      // Another tab of this chatbot is syncing. Try again shortly rather than
      // dropping the request (which made "Sync now" need several presses).
      retry = { refresh, attempt: attempt + 1 };
      return;
    }
    if (begin.status !== 'ready') return;
    planId = begin.planId;

    const results: OpResult[] = [];
    for (const op of begin.ops) results.push(await adapter.apply(op));

    let after: RemoteSnapshot | null = null;
    if (begin.ops.length > 0) {
      after = await adapter.read({ refresh: false, light: true, cache: status.cache }).catch(() => null);
    }
    await send({ type: 'sync/commit', planId, results, after });
  } catch (error) {
    await send({ type: 'sync/fail', planId, message: message(error) }).catch(() => {});
  } finally {
    running = false;
    if (retry) {
      const next = retry;
      retry = null;
      await wait(BUSY_WAIT_MS);
      void run(site, adapter, next.refresh, next.attempt);
      return;
    }
    await send({ type: 'sync/done' }).catch(() => {});
    if (again) {
      const next = again;
      again = null;
      await wait(500);
      void run(site, adapter, next.refresh);
    }
  }
}

/**
 * Keep this chatbot's own memory in step with OmniMemory while one of its
 * tabs is open. Runs shortly after the page loads, and whenever the service
 * worker says something changed (an edit in the dashboard, for example).
 * The worker decides what to write; this only reads and writes the chatbot.
 */
export function startMemorySync(site: SiteId): void {
  const adapter = ADAPTERS[site];
  if (!adapter || !hasRuntime()) return;

  chrome.runtime.onMessage.addListener((raw: unknown, sender) => {
    // Only the service worker (no tab) of this extension may ask.
    if (sender.id !== chrome.runtime.id || sender.tab) return;
    const request = raw as { type?: unknown; refresh?: unknown } | null;
    if (request?.type === 'omni/sync-now') void run(site, adapter, request.refresh === true);
  });

  setTimeout(() => void run(site, adapter, false), 2500);
}
