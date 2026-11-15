/**
 * Core data model. Everything else in the extension is built on these types,
 * and nothing in this folder touches the DOM or the chrome.* APIs, so it runs
 * unchanged in the service worker, extension pages and tests.
 */

export const SITE_IDS = ['chatgpt', 'claude', 'gemini'] as const;
export type SiteId = (typeof SITE_IDS)[number];

export const CATEGORIES = [
  'Personal',
  'Education',
  'Projects',
  'Technology',
  'Preferences',
  'Other',
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Where a memory came from. Chatbot ids mean "saved while on that site". */
export const SOURCES = ['manual', 'chatgpt', 'claude', 'gemini', 'selection', 'import'] as const;
export type Source = (typeof SOURCES)[number];

export type MemoryStatus = 'active' | 'outdated' | 'deleted';

export type SitePermissions = Record<SiteId, boolean>;

export type HistoryAction =
  | 'created'
  | 'edited'
  | 'merged'
  | 'marked-outdated'
  | 'marked-current'
  | 'deleted'
  | 'restored'
  | 'imported';

export interface HistoryEntry {
  at: string;
  action: HistoryAction;
  /** Snapshot of the fields that changed, as they were before the change. */
  previous?: Partial<Pick<Memory, 'content' | 'category' | 'tags'>>;
  note?: string;
}

export interface Memory {
  id: string;
  content: string;
  category: Category;
  tags: string[];
  source: Source;
  created_at: string;
  updated_at: string;
  /** Last time this memory was placed into a chatbot context. */
  last_used_at?: string;
  /** Master switch. false = "keep private": never shared, per-site choices kept. */
  enabled: boolean;
  permissions: SitePermissions;
  status: MemoryStatus;
  /** Set while status === 'deleted'; drives the 30-day restore window. */
  deleted_at?: string;
  /** Status to return to when restored from the trash. */
  status_before_delete?: Exclude<MemoryStatus, 'deleted'>;
  history: HistoryEntry[];
}

export type ThemeSetting = 'system' | 'light' | 'dark';

export interface Settings {
  /** Global kill switch: nothing is returned to any chatbot while true. */
  sharingPaused: boolean;
  /** Per-chatbot pause, independent of per-memory permissions. */
  sitePaused: SitePermissions;
  /** Sharing defaults applied to newly created memories. */
  defaultPermissions: SitePermissions;
  /** Use the visible conversation tail to rank relevance (never stored). */
  relevanceFromPage: boolean;
  theme: ThemeSetting;
  libraryView: 'compact' | 'detailed';
  /**
   * Keep each chatbot's own memory feature in step with OmniMemory
   * (Gemini's "Instructions", ChatGPT's custom instructions). See core/sync.ts.
   */
  siteSync: SitePermissions;
  /** Open a background tab to sync when no tab of that chatbot is open. */
  syncInBackground: boolean;
}

/** A settings change. Per-chatbot switches can be changed one at a time. */
export type SettingsPatch = Partial<Omit<Settings, 'sitePaused' | 'defaultPermissions' | 'siteSync'>> & {
  sitePaused?: Partial<SitePermissions>;
  defaultPermissions?: Partial<SitePermissions>;
  siteSync?: Partial<SitePermissions>;
};

export const DEFAULT_SETTINGS: Settings = {
  sharingPaused: false,
  sitePaused: { chatgpt: false, claude: false, gemini: false },
  defaultPermissions: { chatgpt: true, claude: true, gemini: true },
  relevanceFromPage: true,
  theme: 'system',
  libraryView: 'detailed',
  // Off until the user turns it on for a chatbot (and OKs the first write).
  siteSync: { chatgpt: false, claude: false, gemini: false },
  syncInBackground: true,
};

/** Fields a caller may supply when creating a memory. */
export interface MemoryDraft {
  content: string;
  category?: Category;
  tags?: string[];
  source?: Source;
  enabled?: boolean;
  permissions?: Partial<SitePermissions>;
}

/** Fields a caller may change on an existing memory. */
export interface MemoryPatch {
  content?: string;
  category?: Category;
  tags?: string[];
  enabled?: boolean;
  permissions?: Partial<SitePermissions>;
}

export const TRASH_RETENTION_DAYS = 30;
export const MAX_CONTENT_LENGTH = 2000;
export const MAX_TAGS = 12;
export const MAX_TAG_LENGTH = 32;
export const MAX_HISTORY_ENTRIES = 25;

export function isSiteId(value: unknown): value is SiteId {
  return typeof value === 'string' && (SITE_IDS as readonly string[]).includes(value);
}

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

export function isSource(value: unknown): value is Source {
  return typeof value === 'string' && (SOURCES as readonly string[]).includes(value);
}
