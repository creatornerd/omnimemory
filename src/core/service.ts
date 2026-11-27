import type { StorageBackend } from './backend';
import { suggestCategory } from './categorize';
import {
  DEFAULT_SETTINGS,
  MAX_CONTENT_LENGTH,
  MAX_HISTORY_ENTRIES,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  SITE_IDS,
  TRASH_RETENTION_DAYS,
  DEFAULT_SITE_COLORS,
  isHexColor,
  isCategory,
  isSiteId,
  type HistoryEntry,
  type Memory,
  type MemoryDraft,
  type MemoryPatch,
  type Settings,
  type SettingsPatch,
  type SiteId,
  type SitePermissions,
} from './types';

export class MemoryError extends Error {
  constructor(
    message: string,
    readonly code: 'not-found' | 'invalid' | 'state',
  ) {
    super(message);
    this.name = 'MemoryError';
  }
}

export interface ServiceOptions {
  /** Called after every successful write so other contexts can refresh. */
  onChange?: () => void;
  /** Injectable clock and id source, for tests. */
  now?: () => Date;
  newId?: () => string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function cleanContent(content: unknown): string {
  if (typeof content !== 'string') throw new MemoryError('Memory content must be text.', 'invalid');
  const cleaned = content.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  if (cleaned.length === 0) throw new MemoryError('A memory cannot be empty.', 'invalid');
  if (cleaned.length > MAX_CONTENT_LENGTH) {
    throw new MemoryError(`A memory can be at most ${MAX_CONTENT_LENGTH} characters.`, 'invalid');
  }
  return cleaned;
}

export function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const cleaned = tag.trim().replace(/^#/, '').replace(/\s+/g, ' ').toLowerCase().slice(0, MAX_TAG_LENGTH);
    if (cleaned) seen.add(cleaned);
    if (seen.size >= MAX_TAGS) break;
  }
  return [...seen];
}

/** Chatbot colours: valid hex colours win, null resets to the default, anything else is ignored. */
function mergeColors(
  base: Record<SiteId, string>,
  patch?: Partial<Record<SiteId, string | null>> | null,
): Record<SiteId, string> {
  const next = { ...base };
  if (!patch || typeof patch !== 'object') return next;
  for (const site of SITE_IDS) {
    const value = patch[site];
    if (value === null) next[site] = DEFAULT_SITE_COLORS[site];
    else if (isHexColor(value)) next[site] = value.toLowerCase();
  }
  return next;
}

function mergePermissions(base: SitePermissions, patch?: Partial<SitePermissions>): SitePermissions {
  const next = { ...base };
  if (!patch) return next;
  for (const site of SITE_IDS) {
    if (typeof patch[site] === 'boolean') next[site] = patch[site];
  }
  return next;
}

/** Per-chatbot sharing defaults: null drops a chatbot's own rule, anything malformed is ignored. */
function mergeSourceDefaults(
  base: Partial<Record<SiteId, SitePermissions>>,
  fallback: SitePermissions,
  patch?: Partial<Record<SiteId, Partial<SitePermissions> | null>> | null,
): Partial<Record<SiteId, SitePermissions>> {
  const next: Partial<Record<SiteId, SitePermissions>> = {};
  for (const site of SITE_IDS) if (base?.[site]) next[site] = mergePermissions(fallback, base[site]);
  if (!patch || typeof patch !== 'object') return next;
  for (const site of SITE_IDS) {
    const value = patch[site];
    if (value === null) delete next[site];
    else if (value && typeof value === 'object') next[site] = mergePermissions(next[site] ?? fallback, value);
  }
  return next;
}

function sameTags(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

/**
 * All memory operations. UI code and the service worker both go through this
 * class, so the rules (edits update in place, deletes are soft for 30 days,
 * history is preserved) hold everywhere.
 */
export class MemoryService {
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly onChange: () => void;
  /** Settings changes run one after another, so quick changes can't overwrite each other. */
  private settingsQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly backend: StorageBackend,
    options: ServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.onChange = options.onChange ?? (() => {});
  }

  // ── Reading ────────────────────────────────────────────────────────────

  /** Every stored memory, including trash. Prefer the narrower readers below. */
  async all(): Promise<Memory[]> {
    return this.backend.getAllMemories();
  }

  /** Active + outdated memories (the library). Never includes trash. */
  async library(): Promise<Memory[]> {
    return (await this.all()).filter((memory) => memory.status !== 'deleted');
  }

  async trash(): Promise<Memory[]> {
    return (await this.all())
      .filter((memory) => memory.status === 'deleted')
      .sort((a, b) => (b.deleted_at ?? '').localeCompare(a.deleted_at ?? ''));
  }

  async get(id: string): Promise<Memory | undefined> {
    return this.backend.getMemory(id);
  }

  private async require(id: string): Promise<Memory> {
    const memory = await this.backend.getMemory(id);
    if (!memory) throw new MemoryError('That memory no longer exists.', 'not-found');
    return memory;
  }

  // ── Settings ───────────────────────────────────────────────────────────

  async getSettings(): Promise<Settings> {
    const stored = await this.backend.getSettings();
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      sitePaused: { ...DEFAULT_SETTINGS.sitePaused, ...stored?.sitePaused },
      defaultPermissions: { ...DEFAULT_SETTINGS.defaultPermissions, ...stored?.defaultPermissions },
      siteSync: { ...DEFAULT_SETTINGS.siteSync, ...stored?.siteSync },
      siteColors: mergeColors(DEFAULT_SETTINGS.siteColors, stored?.siteColors),
      sourceDefaults: mergeSourceDefaults(
        stored?.sourceDefaults ?? {},
        { ...DEFAULT_SETTINGS.defaultPermissions, ...stored?.defaultPermissions },
      ),
    };
  }

  /** AI actions used today with OmniMemory's shared key (see shared/platform.ts). */
  /**
   * Today's use of the shared key: "actions" are what the user asked for
   * (the daily allowance); "picks" are the quick automatic checks for
   * memories that fit a message, counted apart with their own cap.
   */
  async getAiUsage(kind: 'actions' | 'picks' = 'actions'): Promise<{ day: string; count: number }> {
    const today = localDay(this.now());
    try {
      const stored = JSON.parse((await this.backend.getSecret(kind === 'picks' ? 'ai-picks' : 'ai-usage')) ?? '{}') as {
        day?: unknown;
        count?: unknown;
      };
      if (stored.day === today && typeof stored.count === 'number') return { day: today, count: stored.count };
    } catch {
      // unreadable: start the day fresh
    }
    return { day: today, count: 0 };
  }

  async recordAiUse(kind: 'actions' | 'picks' = 'actions'): Promise<number> {
    const usage = await this.getAiUsage(kind);
    const count = usage.count + 1;
    await this.backend.putSecret(kind === 'picks' ? 'ai-picks' : 'ai-usage', JSON.stringify({ day: usage.day, count }));
    // Picks aren't shown anywhere, so they don't redraw every page.
    if (kind === 'actions') this.onChange();
    return count;
  }

  /** The user's Gemini API key, if they added one (see core/ai.ts). */
  async getAiKey(): Promise<string | null> {
    return (await this.backend.getSecret('gemini-key')) ?? null;
  }

  async setAiKey(key: string | null): Promise<void> {
    const clean = key?.trim() ?? '';
    if (clean && !/^[\w.-]{20,200}$/.test(clean)) throw new MemoryError('That doesn’t look like a Gemini API key.', 'invalid');
    await this.backend.putSecret('gemini-key', clean || null);
    this.onChange();
  }

  updateSettings(patch: SettingsPatch): Promise<Settings> {
    const run = this.settingsQueue.then(() => this.applySettings(patch));
    this.settingsQueue = run.catch(() => {});
    return run;
  }

  private async applySettings(patch: SettingsPatch): Promise<Settings> {
    const current = await this.getSettings();
    const next: Settings = {
      ...current,
      ...patch,
      sitePaused: mergePermissions(current.sitePaused, patch.sitePaused),
      defaultPermissions: mergePermissions(current.defaultPermissions, patch.defaultPermissions),
      siteSync: mergePermissions(current.siteSync, patch.siteSync),
      siteColors: mergeColors(current.siteColors, patch.siteColors),
      sourceDefaults: mergeSourceDefaults(current.sourceDefaults, current.defaultPermissions, patch.sourceDefaults),
    };
    await this.backend.putSettings(next);
    this.onChange();
    return next;
  }

  // ── Writing ────────────────────────────────────────────────────────────

  private stamp(): string {
    return this.now().toISOString();
  }

  private withHistory(memory: Memory, entry: HistoryEntry): HistoryEntry[] {
    return [...memory.history, entry].slice(-MAX_HISTORY_ENTRIES);
  }

  private async build(draft: MemoryDraft, action: 'created' | 'imported'): Promise<Memory> {
    const settings = await this.getSettings();
    const content = cleanContent(draft.content);
    const at = this.stamp();
    return {
      id: this.newId(),
      content,
      category: isCategory(draft.category) ? draft.category : suggestCategory(content),
      tags: cleanTags(draft.tags),
      source: draft.source ?? 'manual',
      created_at: at,
      updated_at: at,
      enabled: draft.enabled ?? true,
      permissions: mergePermissions(
        (isSiteId(draft.source) && settings.sourceDefaults[draft.source]) || settings.defaultPermissions,
        draft.permissions,
      ),
      ...(draft.aiAllowed === false ? { aiAllowed: false } : {}),
      status: 'active',
      history: [{ at, action }],
    };
  }

  async create(draft: MemoryDraft): Promise<Memory> {
    const memory = await this.build(draft, 'created');
    await this.backend.putMemories([memory]);
    this.onChange();
    return memory;
  }

  /** Create several memories in one write (used by import). */
  async createMany(drafts: MemoryDraft[]): Promise<Memory[]> {
    const memories: Memory[] = [];
    for (const draft of drafts) memories.push(await this.build(draft, 'imported'));
    await this.backend.putMemories(memories);
    if (memories.length > 0) this.onChange();
    return memories;
  }

  /**
   * Edit a memory in place. The id never changes, and the previous values of
   * any edited text fields are appended to its history.
   */
  async update(id: string, patch: MemoryPatch): Promise<Memory> {
    const current = await this.require(id);
    if (current.status === 'deleted') {
      throw new MemoryError('Restore this memory before editing it.', 'state');
    }

    const next: Memory = { ...current };
    const previous: HistoryEntry['previous'] = {};

    if (patch.content !== undefined) {
      const content = cleanContent(patch.content);
      if (content !== current.content) {
        previous.content = current.content;
        next.content = content;
      }
    }
    if (patch.category !== undefined) {
      if (!isCategory(patch.category)) throw new MemoryError('Unknown category.', 'invalid');
      if (patch.category !== current.category) {
        previous.category = current.category;
        next.category = patch.category;
      }
    }
    if (patch.tags !== undefined) {
      const tags = cleanTags(patch.tags);
      if (!sameTags(tags, current.tags)) {
        previous.tags = current.tags;
        next.tags = tags;
      }
    }
    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
    if (typeof patch.aiAllowed === 'boolean') next.aiAllowed = patch.aiAllowed;
    next.permissions = mergePermissions(current.permissions, patch.permissions);

    const textChanged = Object.keys(previous).length > 0;
    const sharingChanged =
      next.enabled !== current.enabled ||
      (next.aiAllowed !== false) !== (current.aiAllowed !== false) ||
      SITE_IDS.some((site) => next.permissions[site] !== current.permissions[site]);
    if (!textChanged && !sharingChanged) return current;

    if (textChanged) {
      next.updated_at = this.stamp();
      next.history = this.withHistory(current, { at: next.updated_at, action: 'edited', previous });
    }
    await this.backend.putMemories([next]);
    this.onChange();
    return next;
  }

  /** Apply the same patch to several memories. Missing/trashed ids are skipped. */
  async updateMany(ids: string[], patch: MemoryPatch): Promise<number> {
    let changed = 0;
    for (const id of ids) {
      const memory = await this.backend.getMemory(id);
      if (!memory || memory.status === 'deleted') continue;
      await this.update(id, patch);
      changed += 1;
    }
    return changed;
  }

  async setOutdated(ids: string[], outdated: boolean): Promise<void> {
    const at = this.stamp();
    const changed: Memory[] = [];
    for (const id of ids) {
      const memory = await this.backend.getMemory(id);
      if (!memory || memory.status === 'deleted') continue;
      const status = outdated ? 'outdated' : 'active';
      if (memory.status === status) continue;
      changed.push({
        ...memory,
        status,
        history: this.withHistory(memory, {
          at,
          action: outdated ? 'marked-outdated' : 'marked-current',
        }),
      });
    }
    if (changed.length === 0) return;
    await this.backend.putMemories(changed);
    this.onChange();
  }

  /** Record that memories were placed into a chatbot context. */
  async markUsed(ids: string[]): Promise<void> {
    const at = this.stamp();
    const changed: Memory[] = [];
    for (const id of ids) {
      const memory = await this.backend.getMemory(id);
      if (memory && memory.status === 'active') changed.push({ ...memory, last_used_at: at });
    }
    if (changed.length === 0) return;
    await this.backend.putMemories(changed);
    this.onChange();
  }

  // ── Trash ──────────────────────────────────────────────────────────────

  /** Soft delete: moves memories to Recently Deleted for 30 days. */
  async remove(ids: string[]): Promise<void> {
    const at = this.stamp();
    const changed: Memory[] = [];
    for (const id of ids) {
      const memory = await this.backend.getMemory(id);
      if (!memory || memory.status === 'deleted') continue;
      changed.push({
        ...memory,
        status: 'deleted',
        status_before_delete: memory.status,
        deleted_at: at,
        history: this.withHistory(memory, { at, action: 'deleted' }),
      });
    }
    if (changed.length === 0) return;
    await this.backend.putMemories(changed);
    this.onChange();
  }

  async restore(ids: string[]): Promise<void> {
    const at = this.stamp();
    const changed: Memory[] = [];
    for (const id of ids) {
      const memory = await this.backend.getMemory(id);
      if (!memory || memory.status !== 'deleted') continue;
      const { deleted_at: _deletedAt, status_before_delete: before, ...rest } = memory;
      changed.push({
        ...rest,
        status: before ?? 'active',
        history: this.withHistory(memory, { at, action: 'restored' }),
      });
    }
    if (changed.length === 0) return;
    await this.backend.putMemories(changed);
    this.onChange();
  }

  /** Permanently erase memories that are already in the trash. */
  async purge(ids: string[]): Promise<void> {
    const inTrash: string[] = [];
    for (const id of ids) {
      const memory = await this.backend.getMemory(id);
      if (memory?.status === 'deleted') inTrash.push(id);
    }
    if (inTrash.length === 0) return;
    await this.backend.deleteMemories(inTrash);
    this.onChange();
  }

  async emptyTrash(): Promise<number> {
    const ids = (await this.trash()).map((memory) => memory.id);
    await this.purge(ids);
    return ids.length;
  }

  /** Erase trash older than the retention window. Safe to call often. */
  async purgeExpired(): Promise<number> {
    const cutoff = this.now().getTime() - TRASH_RETENTION_DAYS * DAY_MS;
    const expired = (await this.trash())
      .filter((memory) => memory.deleted_at && Date.parse(memory.deleted_at) < cutoff)
      .map((memory) => memory.id);
    if (expired.length > 0) {
      await this.backend.deleteMemories(expired);
      this.onChange();
    }
    return expired.length;
  }

  // ── Merge ──────────────────────────────────────────────────────────────

  /**
   * Merge memories into one. The first id survives (keeping its identity and
   * history) with the supplied content; the rest move to the trash, so a
   * merge can be undone by restoring them.
   */
  async merge(ids: string[], content: string): Promise<Memory> {
    const unique = [...new Set(ids)];
    if (unique.length < 2) throw new MemoryError('Pick at least two memories to merge.', 'invalid');
    const memories = await Promise.all(unique.map((id) => this.require(id)));
    if (memories.some((memory) => memory.status === 'deleted')) {
      throw new MemoryError('Memories in the trash cannot be merged.', 'state');
    }

    const [survivor, ...absorbed] = memories;
    const at = this.stamp();
    const mergedContent = cleanContent(content);
    const permissions = { ...survivor.permissions };
    // Sharing is the intersection: merging never widens who can see a fact.
    for (const site of SITE_IDS) {
      permissions[site] = memories.every((memory) => memory.permissions[site]);
    }

    const merged: Memory = {
      ...survivor,
      content: mergedContent,
      tags: cleanTags(memories.flatMap((memory) => memory.tags)),
      enabled: memories.every((memory) => memory.enabled),
      permissions,
      // Merging never widens who can read a fact, the AI included.
      ...(memories.some((memory) => memory.aiAllowed === false) ? { aiAllowed: false } : {}),
      updated_at: at,
      history: this.withHistory(survivor, {
        at,
        action: 'merged',
        previous: { content: survivor.content },
        note: `Merged with ${absorbed.length} other ${absorbed.length === 1 ? 'memory' : 'memories'}`,
      }),
    };
    const trashed: Memory[] = absorbed.map((memory) => ({
      ...memory,
      status: 'deleted',
      status_before_delete: memory.status === 'outdated' ? 'outdated' : 'active',
      deleted_at: at,
      history: this.withHistory(memory, { at, action: 'deleted', note: 'Merged into another memory' }),
    }));

    await this.backend.putMemories([merged, ...trashed]);
    this.onChange();
    return merged;
  }
}

/** "2026-11-16" in the user's own time zone, so the daily allowance resets at their midnight. */
function localDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
