import { IndexedDbBackend } from '../src/core/indexeddb-backend';
import { MemoryService } from '../src/core/service';
import { SyncService } from '../src/core/sync-service';
import { handleRequest } from '../src/background/router';
import { emptySyncState } from '../src/core/sync';
import type { SiteId } from '../src/core/types';
import type { Request, ResponseMap } from '../src/shared/messages';

let counter = 0;

/** A MemoryService on a fresh IndexedDB database with a controllable clock. */
export function createHarness(start = '2026-01-01T00:00:00.000Z') {
  let now = new Date(start).getTime();
  let changes = 0;
  const opened: string[] = [];
  const finished: SiteId[] = [];
  const backend = new IndexedDbBackend(`omnimemory-test-${(counter += 1)}`);
  const service = new MemoryService(backend, {
    now: () => new Date((now += 1000)), // every operation is one second later
    onChange: () => {
      changes += 1;
    },
  });
  let ids = 0;
  const sync = new SyncService(backend, service, {
    now: () => new Date((now += 1000)),
    newId: () => `plan-${(ids += 1)}`,
  });

  /** Send a message exactly as a content script on `site` would. */
  async function ask<K extends Request['type']>(
    site: SiteId,
    request: Extract<Request, { type: K }>,
  ): Promise<ResponseMap[K]> {
    const response = await handleRequest(request, site, {
      service,
      sync,
      openDashboard: (view) => void opened.push(view),
      onSyncFinished: (done) => void finished.push(done),
    });
    if (!response.ok) throw new Error(response.error);
    return response.data as ResponseMap[K];
  }

  /** Contents a chatbot site can currently retrieve. */
  async function visibleTo(site: SiteId, query = ''): Promise<string[]> {
    const result = await ask(site, { type: 'context/query', query, pageText: '' });
    return result.items.map((item) => item.memory.content);
  }

  /**
   * Turn on chatbot sync for ChatGPT and Gemini as if the user had already
   * OK'd the first write (sync is off by default, and the first write asks).
   */
  async function enableSync(sites: SiteId[] = ['chatgpt', 'gemini'], approved = true) {
    await service.updateSettings({ siteSync: Object.fromEntries(sites.map((site) => [site, true])) });
    if (!approved) return;
    for (const site of sites) {
      await backend.putSyncState({ ...emptySyncState(site), approvedAt: '2026-01-01T00:00:00.000Z' });
    }
  }

  return {
    service,
    backend,
    enableSync,
    sync,
    finished,
    ask,
    visibleTo,
    opened,
    changes: () => changes,
    advanceDays: (days: number) => {
      now += days * 24 * 60 * 60 * 1000;
    },
    advanceHours: (hours: number) => {
      now += hours * 60 * 60 * 1000;
    },
  };
}

/** A harness with ChatGPT and Gemini sync turned on and already approved. */
export async function createSyncHarness(start?: string) {
  const h = createHarness(start);
  await h.enableSync();
  return h;
}
