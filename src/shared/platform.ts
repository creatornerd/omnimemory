import { MemoryAssistant, SHARED_DAILY_LIMIT } from '../core/ai';
import type { Settings } from '../core/types';
import { IndexedDbBackend } from '../core/indexeddb-backend';
import { MemoryService } from '../core/service';
import { SyncService } from '../core/sync-service';
import { emitChange } from './change-bus';
import { AiError, generateJson } from './gemini';
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

let assistant: MemoryAssistant | undefined;

/**
 * OmniMemory's shared Gemini key, baked in at build time from .env.local
 * (VITE_OMNI_SHARED_GEMINI_KEY, never committed). Anything shipped inside an
 * extension can be read by whoever installs it, and the daily allowance is
 * counted on the device, so this suits testing; a public release should put
 * the shared key behind a small server instead.
 */
const SHARED_KEY: string = (import.meta.env?.VITE_OMNI_SHARED_GEMINI_KEY as string | undefined)?.trim() ?? '';
export const HAS_SHARED_KEY = SHARED_KEY.length > 0;

const SESSION_KEY = 'omni:gemini-key-session';

/** A key kept only until the browser closes (never written to disk by OmniMemory). */
export async function getSessionAiKey(): Promise<string | null> {
  try {
    if (isExtension()) return ((await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] as string | undefined) ?? null;
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export async function setSessionAiKey(key: string | null): Promise<void> {
  if (isExtension()) {
    if (key) await chrome.storage.session.set({ [SESSION_KEY]: key });
    else await chrome.storage.session.remove(SESSION_KEY);
  } else if (key) sessionStorage.setItem(SESSION_KEY, key);
  else sessionStorage.removeItem(SESSION_KEY);
  emitChange();
}

export type AiKeySource = 'device' | 'session' | 'shared';

/** Which key the AI would use right now: the user's own first, then the shared one. */
export async function aiKey(): Promise<{ key: string; source: AiKeySource } | null> {
  const session = await getSessionAiKey();
  if (session) return { key: session, source: 'session' };
  const saved = await getService().getAiKey();
  if (saved) return { key: saved, source: 'device' };
  return HAS_SHARED_KEY ? { key: SHARED_KEY, source: 'shared' } : null;
}

/** For the UI: where the key comes from and, for the shared key, today's usage. */
export async function aiStatus(): Promise<{ source: AiKeySource | null; used: number; limit: number }> {
  const resolved = await aiKey();
  const used = resolved?.source === 'shared' ? (await getService().getAiUsage()).count : 0;
  return { source: resolved?.source ?? null, used, limit: SHARED_DAILY_LIMIT };
}

/**
 * The AI assistant, or null when the user hasn't turned it on. Used by the
 * extension's own pages and the service worker (for the on-page "suggest
 * from this chat"); the key never reaches a chatbot page. Each successful
 * request on the shared key counts toward today's allowance.
 */
export function getAssistant(settings: Settings): MemoryAssistant | null {
  if (!settings.aiEnabled) return null;
  assistant ??= new MemoryAssistant(async (request, model) => {
    const resolved = await aiKey();
    if (!resolved) throw new AiError('Add your Gemini API key in Settings → AI assistant.');
    if (resolved.source === 'shared') {
      const { count } = await getService().getAiUsage();
      if (count >= SHARED_DAILY_LIMIT) {
        throw new AiError(
          `You’ve used today’s ${SHARED_DAILY_LIMIT} free AI actions. They reset at midnight, or add your own Gemini key in Settings → AI assistant for unlimited use.`,
          false,
          'limit',
        );
      }
    }
    if (resolved.source !== 'shared') return generateJson(request, resolved.key, model);
    let reply: unknown;
    try {
      reply = await generateJson(request, resolved.key, model);
    } catch (error) {
      // The shared key is everyone's: if Google refuses it (its daily cap is
      // reached, or it was restricted), say so instead of "check your key".
      if (error instanceof AiError && error.status !== undefined && error.status >= 400 && error.status < 500) {
        throw new AiError(
          'The free AI allowance is busy right now. Try again later, or add your own Gemini key in Settings → AI assistant for unlimited use.',
          false,
          'limit',
          error.status,
        );
      }
      throw error;
    }
    await getService().recordAiUse();
    return reply;
  });
  return assistant;
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
