import { IndexedDbBackend } from '../core/indexeddb-backend';
import { MemoryService } from '../core/service';
import { SyncService } from '../core/sync-service';
import { emitChange } from './change-bus';
import type { DashboardView } from './messages';

/** True when running as a real extension (not the Vite dev server or tests). */
export function isExtension(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
}

let service: MemoryService | undefined;
let syncService: SyncService | undefined;
let backend: IndexedDbBackend | undefined;

/**
 * The shared MemoryService for extension-origin contexts (popup, dashboard,
 * service worker). They all open the same IndexedDB database.
 */
export function getService(): MemoryService {
  backend ??= new IndexedDbBackend();
  service ??= new MemoryService(backend, { onChange: emitChange });
  return service;
}

/** Chatbot memory sync bookkeeping, on the same database. */
export function getSyncService(): SyncService {
  const memories = getService();
  syncService ??= new SyncService(backend as IndexedDbBackend, memories, { onChange: emitChange });
  return syncService;
}

/** Open the dashboard, re-using an existing dashboard tab when there is one. */
export async function openDashboard(view: DashboardView = 'library'): Promise<void> {
  if (!isExtension()) {
    window.open(`/dashboard.html#/${view}`, '_blank');
    return;
  }
  const base = chrome.runtime.getURL('dashboard.html');
  const url = `${base}#/${view}`;
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
    const existing = contexts.find((context) => context.documentUrl?.startsWith(base));
    if (existing && existing.tabId >= 0) {
      await chrome.tabs.update(existing.tabId, { active: true, url });
      if (existing.windowId >= 0) await chrome.windows.update(existing.windowId, { focused: true });
      return;
    }
  } catch {
    // getContexts is unavailable on older Chrome versions; fall through.
  }
  await chrome.tabs.create({ url });
}

// ── Pending capture (text sent from the right-click menu) ─────────────────

const PENDING_KEY = 'omni:pendingCapture';

export interface PendingCapture {
  text: string;
  at: number;
}

/** Held in session storage: cleared when the browser closes, never synced. */
export async function setPendingCapture(text: string): Promise<void> {
  if (!isExtension()) return;
  await chrome.storage.session.set({ [PENDING_KEY]: { text, at: Date.now() } satisfies PendingCapture });
}

export async function takePendingCapture(): Promise<PendingCapture | null> {
  if (!isExtension()) return null;
  const stored = await chrome.storage.session.get(PENDING_KEY);
  const pending = stored[PENDING_KEY] as PendingCapture | undefined;
  if (!pending) return null;
  await chrome.storage.session.remove(PENDING_KEY);
  // Ignore anything stale; the user has moved on.
  return Date.now() - pending.at < 10 * 60 * 1000 ? pending : null;
}
