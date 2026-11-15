import type { StorageBackend } from './backend';
import { MAX_DISMISSED, discover, textKey, type DiscoverySource, type FoundItem } from './discover';
import { findSensitive } from './sensitive';
import type { MemoryService } from './service';
import {
  FIRST_WRITE,
  SYNC_MODES,
  addActivity,
  applyResults,
  emptySyncState,
  labelSnapshot,
  pendingChanges,
  planSync,
  remember,
  repairContent,
  sameMeaning,
  syncBlocked,
  type ActivityEntry,
  type HeldChange,
  type OpResult,
  type Plan,
  type RemoteEntry,
  type RemoteSnapshot,
  type SiteSyncState,
  type SyncLink,
  type SyncOp,
} from './sync';
import { MAX_CONTENT_LENGTH, SITE_IDS, type SiteId } from './types';

/** How long a tab may hold a plan before another tab can take over. */
const LOCK_MS = 2 * 60 * 1000;

/** Label for the entries OmniMemory manages on each chatbot. */
const MANAGED_GROUP: Record<SiteId, string> = {
  gemini: 'Instructions for Gemini',
  chatgpt: 'Custom instructions · OmniMemory block',
  claude: 'Claude memory',
};

export interface SyncStatus {
  site: SiteId;
  /** null when sync may run; otherwise why not. */
  blocked: string | null;
  pending: number;
  lastSyncAt: string | null;
  lastError: string | null;
  /** Small per-site values the content script keeps between runs. */
  cache: Record<string, string>;
}

export type BeginResult =
  | { status: 'busy' }
  | { status: 'skip'; reason: string }
  | { status: 'ready'; planId: string; ops: SyncOp[]; pulled: number };

export interface CommitSummary {
  written: number;
  failed: number;
  error: string | null;
}

/**
 * Runs one sync of one chatbot in three steps, driven by the content script
 * on that chatbot's site:
 *
 *   begin(remote)   → bring the chatbot's own changes into OmniMemory, then
 *                     work out what to write; returns the writes (ops)
 *   (content script performs the writes on the chatbot's site)
 *   commit(results) → record what the chatbot now holds
 *
 * Only one tab can hold a plan at a time, so two open tabs of the same
 * chatbot can't both add the same memory.
 */
export class SyncService {
  private readonly now: () => Date;
  private readonly onChange: () => void;
  private readonly newId: () => string;

  constructor(
    private readonly backend: StorageBackend,
    private readonly memories: MemoryService,
    options: { now?: () => Date; onChange?: () => void; newId?: () => string } = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.onChange = options.onChange ?? (() => {});
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  async state(site: SiteId): Promise<SiteSyncState> {
    const stored = (await this.backend.getSyncState(site)) as Partial<SiteSyncState> | undefined;
    const state: SiteSyncState = { ...emptySyncState(site), ...stored };
    // Saved by a version from before first-write previews: that chatbot was
    // already being synced, so don't ask again.
    if (stored && stored.approvedAt === undefined && (stored.links?.length ?? 0) > 0) {
      state.approvedAt = stored.lastSyncAt ?? this.now().toISOString();
    }
    return state;
  }

  private async save(state: SiteSyncState): Promise<void> {
    await this.backend.putSyncState(state);
    this.onChange();
  }

  async status(site: SiteId): Promise<SyncStatus> {
    const [state, settings, library] = await Promise.all([
      this.state(site),
      this.memories.getSettings(),
      this.memories.all(),
    ]);
    return {
      site,
      blocked: syncBlocked(settings, site),
      pending: pendingChanges(site, library, settings, state, this.now()),
      lastSyncAt: state.lastSyncAt,
      lastError: state.lastError,
      cache: state.cache,
    };
  }

  async begin(site: SiteId, remote: RemoteSnapshot): Promise<BeginResult> {
    const settings = await this.memories.getSettings();
    const blocked = syncBlocked(settings, site);
    if (blocked) return { status: 'skip', reason: blocked };

    let state = await this.state(site);
    const now = this.now();
    if (state.inflight && now.getTime() - new Date(state.inflight.startedAt).getTime() < LOCK_MS) {
      return { status: 'busy' };
    }

    const repaired = await this.repairMemories();

    // Pass 1: changes made on the chatbot's side come into OmniMemory first.
    const linksBefore = state.links;
    let library = await this.memories.all();
    const first = planSync({ site, memories: library, settings, state, remote, now });
    const pulled = await this.applyPulls(site, first, remote, library);
    let links = pulled.links;
    if (first.pulls.length > 0) library = await this.memories.all();

    // Pass 2: with those applied, work out what to write to the chatbot.
    state = { ...state, links };
    const plan = planSync({ site, memories: library, settings, state, remote, now });
    // Entries the user just agreed to link.
    const linked = plan.links.filter(
      (link) => link.owned === false && !linksBefore.some((old) => old.memoryId === link.memoryId && old.remoteId === link.remoteId),
    );
    links = plan.links;

    const planId = this.newId();
    state = {
      ...state,
      links,
      notes: [
        ...(repaired > 0
          ? [`Repaired ${repaired === 1 ? '1 memory' : `${repaired} memories`} whose text had been mixed up with OmniMemory’s markers by an earlier version. Duplicates went to Recently Deleted.`]
          : []),
        ...plan.notes,
      ],
      held: plan.held,
      activity: addActivity(
        state,
        [...pulled.activity, ...linked.map((link) => ({ kind: 'linked' as const, text: link.remoteText, memoryId: link.memoryId }))],
        now,
      ),
      inflight: { planId, ops: plan.ops, startedAt: now.toISOString() },
      cache: { ...state.cache, leftOut: JSON.stringify(plan.leftOut ?? []) },
    };
    state = this.withSnapshot(state, remote);
    state = { ...state, found: discover(site, this.discoverySources(state), library, [...state.dismissed, ...state.accepted]) };
    await this.save(state);
    return { status: 'ready', planId, ops: plan.ops, pulled: first.pulls.length };
  }

  /**
   * Clean up memories an earlier version damaged (OmniMemory's block markers
   * copied into their text). A repaired memory that now repeats another goes
   * to the trash, where it can still be restored. Returns how many changed.
   */
  private async repairMemories(): Promise<number> {
    const all = await this.memories.all();
    const active = all.filter((memory) => memory.status !== 'deleted');
    const contents = new Map(active.map((memory) => [memory.id, memory.content]));
    let changed = 0;
    for (const memory of active) {
      const cleaned = repairContent(memory.content);
      if (cleaned === null) continue;
      changed += 1;
      const duplicate = [...contents].some(([id, content]) => id !== memory.id && sameMeaning(content, cleaned));
      try {
        if (!cleaned || duplicate) {
          await this.memories.remove([memory.id]);
          contents.delete(memory.id);
        } else {
          await this.memories.update(memory.id, { content: cleaned });
          contents.set(memory.id, cleaned);
        }
      } catch (error) {
        console.warn('[OmniMemory] could not repair a memory', error);
      }
    }
    return changed;
  }

  /** Apply pulls; returns the links adjusted to match, and what changed. */
  private async applyPulls(
    site: SiteId,
    plan: Plan,
    remote: RemoteSnapshot,
    library: { id: string; content: string }[],
  ): Promise<{ links: SyncLink[]; activity: Omit<ActivityEntry, 'id' | 'at'>[] }> {
    let links = [...plan.links];
    const activity: Omit<ActivityEntry, 'id' | 'at'>[] = [];
    const contentOf = (id: string) => library.find((memory) => memory.id === id)?.content ?? '';
    for (const pull of plan.pulls) {
      try {
        if (pull.kind === 'edit') {
          const before = contentOf(pull.memoryId);
          const memory = await this.memories.update(pull.memoryId, { content: pull.content });
          activity.push({ kind: 'edited-there', text: memory.content, memoryId: memory.id, before });
          const entryText = SYNC_MODES[site] === 'items'
            ? remote.managed.find((entry) => entry.id === links.find((l) => l.memoryId === pull.memoryId)?.remoteId)?.text
            : undefined;
          links = links.map((link) =>
            link.memoryId === pull.memoryId
              ? { ...link, pushedText: memory.content, remoteText: entryText ?? link.remoteText }
              : link,
          );
        } else if (pull.kind === 'unshare') {
          await this.memories.update(pull.memoryId, { permissions: { [site]: false } });
          links = links.filter((link) => link.memoryId !== pull.memoryId);
          activity.push({ kind: 'removed-there', text: contentOf(pull.memoryId), memoryId: pull.memoryId });
        } else {
          const memory = await this.memories.create({
            content: pull.content.slice(0, MAX_CONTENT_LENGTH),
            source: site,
          });
          activity.push({ kind: 'imported', text: memory.content, memoryId: memory.id });
          if (pull.remoteId) {
            links.push({ memoryId: memory.id, remoteId: pull.remoteId, pushedText: memory.content, remoteText: pull.remoteText, owned: false });
          }
        }
      } catch (error) {
        console.warn('[OmniMemory] could not apply a change from', site, error);
      }
    }
    return { links, activity };
  }

  private withSnapshot(state: SiteSyncState, remote: RemoteSnapshot): SiteSyncState {
    const managed: RemoteEntry[] = remote.managed.map((entry) => ({
      id: entry.id,
      group: MANAGED_GROUP[state.site],
      text: entry.text,
    }));
    const kept = (state.snapshot?.entries ?? []).filter((entry) => remote.unchangedGroups?.includes(entry.group));
    return {
      ...state,
      snapshot: {
        entries: labelSnapshot([...managed, ...remote.readOnly, ...kept], state.links, remote.managed),
        fetchedAt: this.now().toISOString(),
      },
    };
  }

  async commit(
    site: SiteId,
    planId: string,
    results: OpResult[],
    after: RemoteSnapshot | null,
  ): Promise<CommitSummary> {
    let state = await this.state(site);
    if (!state.inflight || state.inflight.planId !== planId) {
      return { written: 0, failed: 0, error: 'This sync was superseded by another tab.' };
    }
    const { ops } = state.inflight;
    state = applyResults(state, { ops, links: state.links, notes: state.notes, leftOut: safeIds(state.cache.leftOut) }, results, this.now());
    if (after) {
      state = this.withSnapshot(state, after);
      state = { ...state, found: discover(site, this.discoverySources(state), await this.memories.all(), [...state.dismissed, ...state.accepted]) };
    }
    await this.save(state);
    const failed = results.filter((result) => !result.ok).length;
    return { written: results.length - failed, failed, error: state.lastError };
  }

  /** The chatbot couldn't be read or written at all (signed out, offline…). */
  async fail(site: SiteId, planId: string | null, message: string): Promise<void> {
    const state = await this.state(site);
    if (planId && state.inflight && state.inflight.planId !== planId) return;
    await this.save({ ...state, inflight: null, lastError: message.slice(0, 300), lastSyncAt: this.now().toISOString() });
  }

  /** Remember a small value for the content script (e.g. a checksum). */
  async setCache(site: SiteId, key: string, value: string): Promise<void> {
    const state = await this.state(site);
    await this.backend.putSyncState({ ...state, cache: { ...state.cache, [key]: value.slice(0, 200) } });
  }

  /**
   * What on this chatbot could become a memory: its entries that aren't
   * linked to one (Gemini), and everything it remembers that OmniMemory only
   * reads (ChatGPT's summary, saved memories, other custom instructions).
   */
  private discoverySources(state: SiteSyncState): DiscoverySource[] {
    const managedGroup = MANAGED_GROUP[state.site];
    const itemsMode = SYNC_MODES[state.site] === 'items';
    const sources: DiscoverySource[] = [];
    for (const entry of state.snapshot?.entries ?? []) {
      if (entry.memoryId) continue;
      if (entry.group === managedGroup) {
        // ChatGPT block lines are OmniMemory's own; only Gemini's entries count.
        if (itemsMode) sources.push({ group: entry.group, text: entry.text, remoteId: entry.id, whole: true });
        continue;
      }
      sources.push({
        group: entry.group,
        title: entry.title,
        text: entry.text,
        whole: entry.title === 'How ChatGPT should respond',
      });
    }
    return sources;
  }

  /** Everything waiting on the Review page, across all chatbots. */
  async allFound(): Promise<FoundItem[]> {
    const states = await Promise.all(SITE_IDS.map((site) => this.state(site)));
    return states.flatMap((state) => state.found);
  }

  /**
   * Keep the chosen suggestions: each becomes a memory (with the user's
   * edits), and everything else on the list is skipped so it isn't suggested
   * again. The new memories then sync to every chatbot they're shared with.
   */
  async review(keep: { id: string; text: string }[], skip: string[]): Promise<{ added: number; refused: string[] }> {
    const refused: string[] = [];
    let added = 0;
    const keepIds = new Map(keep.map((item) => [item.id, item.text]));
    for (const site of SITE_IDS) {
      let state = await this.state(site);
      const handled = state.found.filter((item) => keepIds.has(item.id) || skip.includes(item.id));
      if (handled.length === 0) continue;
      const links = [...state.links];
      for (const item of handled) {
        const text = keepIds.get(item.id);
        if (text === undefined) continue;
        const content = text.replace(/\s+\n/g, '\n').trim().slice(0, MAX_CONTENT_LENGTH);
        if (!content) continue;
        if (findSensitive(content).length > 0) {
          refused.push(content);
          continue;
        }
        const memory = await this.memories.create({ content, source: site });
        added += 1;
        if (item.remoteId && SYNC_MODES[site] === 'items') {
          // Link it to the entry it came from, so the chatbot isn't given a
          // second copy (and gets the edited wording, if it was changed).
          links.push({ memoryId: memory.id, remoteId: item.remoteId, pushedText: item.original, remoteText: item.original, owned: false });
        }
      }
      // Re-read: a sync may have run meanwhile.
      state = await this.state(site);
      const handledIds = new Set(handled.map((item) => item.id));
      const keyOf = (item: FoundItem) => textKey(item.text);
      const keptKeys = handled.filter((item) => keepIds.has(item.id)).map(keyOf);
      const skippedKeys = handled.filter((item) => !keepIds.has(item.id)).map(keyOf);
      state = {
        ...state,
        links: [...state.links, ...links.filter((link) => !state.links.some((l) => l.memoryId === link.memoryId))],
        found: state.found.filter((item) => !handledIds.has(item.id)),
        dismissed: [...new Set([...state.dismissed, ...skippedKeys])].slice(-MAX_DISMISSED),
        accepted: [...new Set([...state.accepted, ...keptKeys])].slice(-MAX_DISMISSED),
      };
      await this.save(state);
    }
    return { added, refused };
  }

  /** Bring back everything that was skipped, at the next sync. */
  async resetSkipped(): Promise<void> {
    for (const site of SITE_IDS) {
      const state = await this.state(site);
      if (state.dismissed.length > 0) await this.save({ ...state, dismissed: [] });
    }
  }

  // ── Asking first ─────────────────────────────────────────────────────────

  /** Every change waiting for the user's OK, across all chatbots. */
  async allHeld(): Promise<(HeldChange & { site: SiteId })[]> {
    const states = await Promise.all(SITE_IDS.map((site) => this.state(site)));
    return states.flatMap((state) => state.held.map((change) => ({ ...change, site: state.site })));
  }

  /**
   * The user's answer to a held change. The next sync acts on it (the
   * dashboard starts one straight away).
   *  - first-write: yes = start writing to this chatbot
   *  - adopt: yes = link the chatbot's entry to the memory; no = leave the
   *    chatbot's entry alone and don't add a copy
   *  - delete: yes = remove it from the chatbot; no = keep it there, no longer
   *    linked to OmniMemory
   */
  async decide(site: SiteId, key: string, yes: boolean): Promise<void> {
    let state = await this.state(site);
    const change = state.held.find((item) => item.key === key);
    const held = state.held.filter((item) => item.key !== key);
    if (key === FIRST_WRITE) {
      state = { ...state, held, approvedAt: yes ? this.now().toISOString() : state.approvedAt };
    } else if (yes) {
      state = { ...state, held, approved: remember(state.approved, key), declined: state.declined.filter((k) => k !== key) };
    } else if (change?.kind === 'delete') {
      const remoteId = key.slice('delete:'.length);
      state = {
        ...state,
        held,
        links: state.links.filter((link) => link.remoteId !== remoteId),
        // It stays on the chatbot as the chatbot's own; don't offer it back
        // on the Review page either.
        dismissed: change.remoteText ? remember(state.dismissed, textKey(change.remoteText)) : state.dismissed,
      };
    } else {
      state = { ...state, held, declined: remember(state.declined, key), approved: state.approved.filter((k) => k !== key) };
    }
    await this.save(state);
  }

  /** Say yes to everything waiting on this chatbot. */
  async approveAll(site: SiteId): Promise<void> {
    for (const change of (await this.state(site)).held) await this.decide(site, change.key, true);
  }

  /**
   * Undo something syncing did. Works by changing the memory in OmniMemory;
   * the next sync then puts the chatbot back in step.
   */
  async undo(site: SiteId, activityId: string): Promise<string> {
    const state = await this.state(site);
    const entry = state.activity.find((item) => item.id === activityId);
    if (!entry || entry.undoneAt || !entry.memoryId) throw new Error('This can’t be undone.');
    const memory = await this.memories.get(entry.memoryId);
    let message: string;
    switch (entry.kind) {
      case 'linked': {
        // Unlink, and leave the chatbot's own entry exactly where it was.
        const fresh = await this.state(site);
        const link = fresh.links.find((item) => item.memoryId === entry.memoryId && item.owned === false);
        if (!link) throw new Error('It’s no longer linked.');
        await this.save({
          ...fresh,
          links: fresh.links.filter((item) => item !== link),
          declined: remember(fresh.declined, `adopt:${link.memoryId}:${link.remoteId}`),
        });
        message = 'Unlinked. The chatbot keeps its own entry, and OmniMemory won’t change it.';
        break;
      }
      case 'added':
        if (!memory) throw new Error('That memory no longer exists.');
        await this.memories.update(memory.id, { permissions: { [site]: false } });
        message = 'Stopped sharing it with this chatbot. It will be taken off at the next sync.';
        break;
      case 'removed':
      case 'removed-there':
        if (!memory) throw new Error('That memory was deleted for good.');
        if (memory.status === 'deleted') await this.memories.restore([memory.id]);
        await this.memories.update(memory.id, { permissions: { [site]: true } });
        message = 'Put back. It will be added to the chatbot again at the next sync.';
        break;
      case 'edited-there':
        if (!memory || entry.before === undefined) throw new Error('That memory no longer exists.');
        await this.memories.update(memory.id, { content: entry.before });
        message = 'Changed back. The chatbot gets the old wording at the next sync.';
        break;
      case 'imported':
        if (!memory) throw new Error('That memory no longer exists.');
        await this.memories.remove([memory.id]);
        message = 'Moved to Recently Deleted.';
        break;
      default:
        throw new Error('This can’t be undone.');
    }
    const fresh = await this.state(site);
    await this.save({
      ...fresh,
      activity: fresh.activity.map((item) => (item.id === activityId ? { ...item, undoneAt: this.now().toISOString() } : item)),
    });
    return message;
  }

  /** Forget all bookkeeping for a chatbot (its own memory is left as it is). */
  async reset(site: SiteId): Promise<void> {
    await this.save(emptySyncState(site));
  }
}

function safeIds(value: string | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
