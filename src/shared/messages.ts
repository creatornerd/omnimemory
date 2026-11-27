import {
  CATEGORIES,
  MAX_CONTENT_LENGTH,
  MAX_TAGS,
  SITE_IDS,
  isCategory,
  type Category,
  type SiteId,
  type SitePermissions,
  type Source,
} from '../core/types';
import type { SharingBlock } from '../core/permissions';
import type { MatchKind } from '../core/duplicates';
import type { OpResult, RemoteEntry, RemoteSnapshot } from '../core/sync';
import type { BeginResult, CommitSummary, SyncStatus } from '../core/sync-service';

/**
 * The complete protocol between content scripts and the service worker.
 *
 * Content scripts run inside third-party pages, so the service worker treats
 * every message as untrusted input: it is parsed by `parseRequest` (unknown
 * shapes are rejected, strings are length-capped) and the calling site is
 * taken from the browser-supplied sender, never from the message body.
 */

export const MAX_QUERY_LENGTH = 200;
export const MAX_PAGE_TEXT_LENGTH = 6000;
export const MAX_IDS = 100;
export const MAX_CONVERSATION_TEXT = 8000;
/** What's typed, and the chat just before it, when asking which memories fit. */
export const MAX_FIT_DRAFT = 1500;
export const MAX_FIT_RECENT = 1500;

export type DashboardView = 'home' | 'library' | 'assistant' | 'review' | 'chatbots' | 'trash' | 'settings' | 'about';
export const DASHBOARD_VIEWS: readonly DashboardView[] = [
  'home',
  'library',
  'assistant',
  'review',
  'chatbots',
  'trash',
  'settings',
  'about',
];

// Limits for what a chatbot page may report about its own memory.
export const MAX_REMOTE_ENTRIES = 300;
export const MAX_REMOTE_TEXT = 4000;
export const MAX_REMOTE_ID = 200;

export type Request =
  | { type: 'context/query'; query: string; pageText: string }
  | { type: 'context/build'; ids: string[] }
  /** Which memories fit the message being typed (by AI when it's on, otherwise by words). */
  | { type: 'context/fit'; draft: string; recent: string }
  | { type: 'context/used'; ids: string[] }
  | { type: 'memory/review'; content: string }
  | { type: 'memory/create'; content: string; category?: Category; tags: string[]; permissions?: Partial<SitePermissions> }
  | { type: 'memory/update'; id: string; content: string }
  | { type: 'memory/unshare'; id: string }
  | { type: 'memory/delete'; id: string }
  /** Take back a hide or delete this page made a moment ago. */
  | { type: 'memory/undo'; id: string }
  | { type: 'ui/open-dashboard'; view: DashboardView }
  // Optional AI: suggest memories from the chat on screen (only when the user asks).
  | { type: 'ai/suggest'; conversation: string }
  // Chatbot memory sync (see core/sync.ts). The content script reads and
  // writes the chatbot's own memory; the worker decides what to write.
  | { type: 'sync/status' }
  | { type: 'sync/begin'; remote: RemoteSnapshot }
  | { type: 'sync/commit'; planId: string; results: OpResult[]; after: RemoteSnapshot | null }
  | { type: 'sync/fail'; planId: string | null; message: string }
  | { type: 'sync/cache'; key: string; value: string }
  | { type: 'sync/done' };

/** The subset of a memory that a chatbot page is allowed to see. */
export interface SharedMemory {
  id: string;
  content: string;
  category: Category;
  tags: string[];
  updated_at: string;
  /** Where it was saved (a chatbot, by hand, an import). */
  source: Source;
}

export interface QueryResult {
  site: SiteId;
  /** This chatbot's colour, as chosen in Settings → Appearance. */
  color: string;
  blocked: SharingBlock;
  /** How many memories this site may currently receive in total. */
  total: number;
  items: { memory: SharedMemory; relevant: boolean }[];
  /** The AI assistant is on, so "suggest from this chat" can be offered. */
  ai: boolean;
  /** Who a memory saved here is shared with unless the user changes it. */
  shareDefaults: SitePermissions;
  /** Memory sync with this chatbot is on. */
  syncOn: boolean;
}

export interface FitResult {
  /** Most useful first. Empty when nothing really fits. */
  items: SharedMemory[];
  /** How they were picked: by Gemini, or by matching words on this device. */
  by: 'ai' | 'words';
}

export interface SuggestResult {
  suggestions: { text: string; category: Category }[];
  alreadyHave: number;
}

/** The exact text that will be inserted or copied, built by the service worker. */
export interface ContextResult {
  text: string;
  /** Ids that made it in. Anything no longer shareable is silently dropped. */
  includedIds: string[];
  truncated: boolean;
}

export interface ReviewResult {
  suggestedCategory: Category;
  /** Non-empty when the text looks like a credential; saving is refused. */
  sensitive: string;
  similar: { kind: MatchKind; reason: string; content: string }[];
}

export interface ResponseMap {
  'context/query': QueryResult;
  'context/build': ContextResult;
  'context/fit': FitResult;
  'context/used': null;
  'memory/review': ReviewResult;
  'memory/create': SharedMemory;
  'memory/update': SharedMemory;
  'memory/unshare': null;
  'memory/delete': null;
  'memory/undo': null;
  'ui/open-dashboard': null;
  'ai/suggest': SuggestResult;
  'sync/status': SyncStatus;
  'sync/begin': BeginResult;
  'sync/commit': CommitSummary;
  'sync/fail': null;
  'sync/cache': null;
  'sync/done': null;
}

export type Response<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

// ── Validation ───────────────────────────────────────────────────────────

class InvalidMessage extends Error {}

function str(value: unknown, max: number, field: string, allowEmpty = false): string {
  if (typeof value !== 'string') throw new InvalidMessage(`${field} must be a string`);
  if (value.length > max) throw new InvalidMessage(`${field} is too long`);
  if (!allowEmpty && value.trim().length === 0) throw new InvalidMessage(`${field} is empty`);
  return value;
}

function id(value: unknown): string {
  const text = str(value, 64, 'id');
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new InvalidMessage('id is malformed');
  return text;
}

function stringList(value: unknown, maxItems: number, maxLength: number, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw new InvalidMessage(`${field} is invalid`);
  return value.map((item) => str(item, maxLength, field));
}

function optionalStr(value: unknown, max: number, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return str(value, max, field, true);
}

function permissions(value: unknown): Partial<SitePermissions> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidMessage('permissions is invalid');
  const raw = value as Record<string, unknown>;
  const out: Partial<SitePermissions> = {};
  for (const site of SITE_IDS) {
    if (raw[site] === undefined) continue;
    if (typeof raw[site] !== 'boolean') throw new InvalidMessage('permissions is invalid');
    out[site] = raw[site] as boolean;
  }
  return out;
}

function planId(value: unknown): string {
  const text = str(value, 64, 'planId');
  if (!/^[A-Za-z0-9-]+$/.test(text)) throw new InvalidMessage('planId is malformed');
  return text;
}

function remoteSnapshot(value: unknown): RemoteSnapshot {
  if (!value || typeof value !== 'object') throw new InvalidMessage('remote is invalid');
  const raw = value as Record<string, unknown>;
  const list = (items: unknown, field: string): Record<string, unknown>[] => {
    if (!Array.isArray(items) || items.length > MAX_REMOTE_ENTRIES) throw new InvalidMessage(`${field} is invalid`);
    return items.map((item) => {
      if (!item || typeof item !== 'object') throw new InvalidMessage(`${field} is invalid`);
      return item as Record<string, unknown>;
    });
  };
  // Entries with no text (e.g. ChatGPT's "Dive deeper" summary section, which
  // only holds suggestions) are skipped rather than failing the whole sync.
  const hasText = (item: Record<string, unknown>) => !(typeof item.text === 'string' && item.text.trim() === '');
  const managed = list(raw.managed, 'managed').filter(hasText).map((item) => ({
    id: str(item.id, MAX_REMOTE_ID, 'managed.id'),
    text: str(item.text, MAX_REMOTE_TEXT, 'managed.text'),
  }));
  const readOnly: RemoteEntry[] = list(raw.readOnly, 'readOnly').filter(hasText).map((item) => ({
    id: str(item.id, MAX_REMOTE_ID, 'readOnly.id'),
    group: str(item.group, 80, 'readOnly.group'),
    title: optionalStr(item.title, 200, 'readOnly.title'),
    text: str(item.text, MAX_REMOTE_TEXT, 'readOnly.text'),
  }));
  let blockBudget: number | undefined;
  if (raw.blockBudget !== undefined) {
    if (typeof raw.blockBudget !== 'number' || !Number.isFinite(raw.blockBudget)) {
      throw new InvalidMessage('blockBudget is invalid');
    }
    blockBudget = Math.max(0, Math.min(5000, Math.floor(raw.blockBudget)));
  }
  let unchangedGroups: string[] | undefined;
  if (raw.unchangedGroups !== undefined) {
    if (!Array.isArray(raw.unchangedGroups) || raw.unchangedGroups.length > 10) {
      throw new InvalidMessage('unchangedGroups is invalid');
    }
    unchangedGroups = raw.unchangedGroups.map((group) => str(group, 80, 'unchangedGroups'));
  }
  if (raw.needsRewrite !== undefined && typeof raw.needsRewrite !== 'boolean') {
    throw new InvalidMessage('needsRewrite is invalid');
  }
  return { managed, readOnly, blockBudget, unchangedGroups, needsRewrite: raw.needsRewrite === true || undefined };
}

function opResults(value: unknown): OpResult[] {
  if (!Array.isArray(value) || value.length > MAX_REMOTE_ENTRIES) throw new InvalidMessage('results is invalid');
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new InvalidMessage('results is invalid');
    const raw = item as Record<string, unknown>;
    if (typeof raw.ok !== 'boolean') throw new InvalidMessage('results is invalid');
    return {
      ok: raw.ok,
      remoteId: optionalStr(raw.remoteId, MAX_REMOTE_ID, 'remoteId'),
      remoteText: optionalStr(raw.remoteText, MAX_REMOTE_TEXT, 'remoteText'),
      error: optionalStr(raw.error, 300, 'error'),
    };
  });
}

/** Parse an untrusted message. Returns null for anything that is not a valid request. */
export function parseRequest(raw: unknown): Request | null {
  const parsed = parseRequestWithReason(raw);
  return 'request' in parsed ? parsed.request : null;
}

/** Same as parseRequest, but says what was wrong (shown in error messages). */
export function parseRequestWithReason(raw: unknown): { request: Request } | { error: string } {
  try {
    const request = parseInner(raw);
    return request ? { request } : { error: 'unknown request type' };
  } catch (error) {
    if (error instanceof InvalidMessage) return { error: error.message };
    throw error;
  }
}

function parseInner(raw: unknown): Request | null {
  if (!raw || typeof raw !== 'object') return null;
  const message = raw as Record<string, unknown>;
  switch (message.type) {
    case 'context/query':
      return {
        type: 'context/query',
        query: str(message.query ?? '', MAX_QUERY_LENGTH, 'query', true),
        pageText: str(message.pageText ?? '', MAX_PAGE_TEXT_LENGTH, 'pageText', true),
      };
    case 'context/fit':
      return {
        type: 'context/fit',
        draft: str(message.draft ?? '', MAX_FIT_DRAFT, 'draft', true),
        recent: str(message.recent ?? '', MAX_FIT_RECENT, 'recent', true),
      };
    case 'context/build':
    case 'context/used':
      return { type: message.type, ids: stringList(message.ids, MAX_IDS, 64, 'ids').map(id) };
    case 'memory/review':
      return { type: 'memory/review', content: str(message.content, MAX_CONTENT_LENGTH, 'content') };
    case 'ai/suggest':
      return { type: 'ai/suggest', conversation: str(message.conversation, MAX_CONVERSATION_TEXT, 'conversation') };
    case 'memory/create': {
      if (message.category !== undefined && !isCategory(message.category)) {
        throw new InvalidMessage(`category must be one of ${CATEGORIES.join(', ')}`);
      }
      return {
        type: 'memory/create',
        content: str(message.content, MAX_CONTENT_LENGTH, 'content'),
        category: message.category as Category | undefined,
        tags: stringList(message.tags, MAX_TAGS, 64, 'tags'),
        ...(message.permissions === undefined ? {} : { permissions: permissions(message.permissions) }),
      };
    }
    case 'memory/update':
      return {
        type: 'memory/update',
        id: id(message.id),
        content: str(message.content, MAX_CONTENT_LENGTH, 'content'),
      };
    case 'memory/unshare':
    case 'memory/delete':
    case 'memory/undo':
      return { type: message.type, id: id(message.id) };
    case 'ui/open-dashboard': {
      const view = message.view ?? 'library';
      if (!(DASHBOARD_VIEWS as readonly unknown[]).includes(view)) throw new InvalidMessage('unknown view');
      return { type: 'ui/open-dashboard', view: view as DashboardView };
    }
    case 'sync/status':
    case 'sync/done':
      return { type: message.type };
    case 'sync/begin':
      return { type: 'sync/begin', remote: remoteSnapshot(message.remote) };
    case 'sync/commit':
      return {
        type: 'sync/commit',
        planId: planId(message.planId),
        results: opResults(message.results),
        after: message.after === null || message.after === undefined ? null : remoteSnapshot(message.after),
      };
    case 'sync/fail':
      return {
        type: 'sync/fail',
        planId: message.planId === null || message.planId === undefined ? null : planId(message.planId),
        message: str(message.message, 300, 'message'),
      };
    case 'sync/cache': {
      const key = str(message.key, 40, 'key');
      if (!/^[a-zA-Z]+$/.test(key)) throw new InvalidMessage('key is malformed');
      return { type: 'sync/cache', key, value: str(message.value, 200, 'value', true) };
    }
    default:
      return null;
  }
}
