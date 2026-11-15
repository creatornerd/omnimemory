import type { FoundItem } from './discover';
import { sharingBlock, isShareableWith } from './permissions';
import { findSensitive } from './sensitive';
import { normalizeText } from './text';
import { MAX_CONTENT_LENGTH, type Memory, type Settings, type SiteId } from './types';

/**
 * Keeping each chatbot's *own* memory feature in step with OmniMemory.
 *
 * None of the chatbots offers a public API for this, so each one is synced
 * through the same private web requests its own settings page makes. Those
 * requests are made by the content script on the chatbot's own site (so they
 * carry the user's normal sign-in and nothing else); this file is the pure
 * decision logic that says *what* to send. It never touches the network.
 *
 * Two shapes of chatbot memory are supported:
 *
 *  - "items": a list of separate entries that can be added, edited and
 *    removed one by one (Gemini → Settings → Instructions for Gemini).
 *    Each OmniMemory memory maps to one entry.
 *
 *  - "block": one free-text field (ChatGPT → Personalization → Custom
 *    instructions → "More about you"). OmniMemory owns a clearly marked block
 *    inside that field, one line per memory, and leaves everything else the
 *    user wrote there untouched.
 *
 * Rules, in order:
 *  1. Only memories that may be shared with that chatbot right now are ever
 *     written to it (same rule as Insert context). While sharing is paused,
 *     nothing is written or removed.
 *  2. A memory that stops being shareable (deleted, private, outdated, or
 *     switched off for that chatbot) is removed from the chatbot.
 *  3. A change made on OmniMemory's side always wins.
 *  4. A change made on the chatbot's side to something OmniMemory put there
 *     is brought back: edited → memory edited, removed → memory stops being
 *     shared with that chatbot. Anything else the chatbot remembers is never
 *     imported automatically; it goes to the Review checklist (discover.ts).
 *     (Exception: a line typed into OmniMemory's own ChatGPT block is taken
 *     as a new memory, since it was put in OmniMemory's block on purpose.)
 *  5. Text that looks like a credential is never copied in either direction.
 */

export type SyncMode = 'items' | 'block';

/** How each chatbot can be synced. null = not available yet. */
export const SYNC_MODES: Record<SiteId, SyncMode | null> = {
  gemini: 'items',
  chatgpt: 'block',
  claude: null,
};

/** Where on the chatbot's side the synced memories live, for the UI. */
export const SYNC_TARGETS: Record<SiteId, string> = {
  gemini: 'Settings → Instructions for Gemini',
  chatgpt: 'Settings → Personalization → Custom instructions → More about you',
  claude: 'Claude memory',
};

/** ChatGPT's custom-instruction fields hold at most this many characters. */
export const BLOCK_FIELD_LIMIT = 1500;
export const BLOCK_START = '[OmniMemory — edit these in the OmniMemory extension]';
export const BLOCK_END = '[/OmniMemory]';

/** Don't retry a write the chatbot refused until this long has passed. */
const FAILURE_BACKOFF_MS = 6 * 60 * 60 * 1000;
export const MAX_FAILURES = 50;

// ── State ────────────────────────────────────────────────────────────────

/** One OmniMemory memory as it currently exists on a chatbot. */
export interface SyncLink {
  memoryId: string;
  /** The chatbot's id for the entry ("items" mode only). */
  remoteId: string | null;
  /** What OmniMemory last wrote (memory text for items, the line for block). */
  pushedText: string;
  /** What the chatbot showed right after that write. */
  remoteText: string;
  /**
   * true = OmniMemory put this entry on the chatbot. false = the chatbot had
   * it first and the user agreed to link it. Missing = linked by an older
   * version, which didn't keep track (treated like false: removing it asks).
   */
  owned?: boolean;
}

/** Something the chatbot remembers, shown read-only in the dashboard. */
export interface RemoteEntry {
  id: string;
  /** Which part of the chatbot's settings this came from. */
  group: string;
  title?: string;
  text: string;
  /** Set when this entry is an OmniMemory memory synced there. */
  memoryId?: string;
}

export interface RemoteSnapshot {
  /** Entries OmniMemory can manage (Gemini items, or lines in the ChatGPT block). */
  managed: { id: string; text: string }[];
  /** Everything else the chatbot remembers. Never written to. */
  readOnly: RemoteEntry[];
  /** "block" mode: characters available for the OmniMemory block. */
  blockBudget?: number;
  /** Groups not re-read this time; keep what was shown before. */
  unchangedGroups?: string[];
  /** "block" mode: the field isn't in its clean form and should be rewritten. */
  needsRewrite?: boolean;
}

export interface SyncFailure {
  memoryId: string;
  text: string;
  at: string;
  error: string;
}

export interface SiteSyncState {
  site: SiteId;
  links: SyncLink[];
  /** What the chatbot remembered at the last sync, for the dashboard. */
  snapshot: { entries: RemoteEntry[]; fetchedAt: string } | null;
  lastSyncAt: string | null;
  lastError: string | null;
  /** Human-readable notes from the last run ("2 memories didn't fit"). */
  notes: string[];
  failures: SyncFailure[];
  /** The plan handed to a tab and not yet committed (a simple lock). */
  inflight: { planId: string; ops: SyncOp[]; startedAt: string } | null;
  /** Opaque per-site cache (e.g. ChatGPT's summary checksum). */
  cache: Record<string, string>;
  /** Things this chatbot remembers that OmniMemory doesn't, awaiting review. */
  found: FoundItem[];
  /** Keys (textKey) of suggestions the user skipped. */
  dismissed: string[];
  /** Keys of suggestions the user kept (never suggested again). */
  accepted: string[];
  /**
   * When the user OK'd OmniMemory's first write to this chatbot. Until then
   * nothing is written; the dashboard shows a preview instead.
   */
  approvedAt: string | null;
  /** Keys of held changes (see HeldChange) the user approved. */
  approved: string[];
  /** Keys of held changes the user turned down. */
  declined: string[];
  /** Changes waiting for the user's OK, from the last sync. */
  held: HeldChange[];
  /** What syncing changed, newest last, for the dashboard (with undo). */
  activity: ActivityEntry[];
}

/**
 * A change OmniMemory won't make without asking first:
 *  - "first-write": the first time it writes to a chatbot (shown as a preview)
 *  - "adopt": the chatbot already has an entry that says the same as one of
 *    your memories; linking means OmniMemory edits and removes it from now on
 *  - "delete": removing an entry OmniMemory didn't put there itself
 */
export interface HeldChange {
  key: string;
  kind: 'first-write' | 'adopt' | 'delete';
  memoryId?: string | null;
  /** The memory's text, when there is one. */
  memoryText?: string;
  /** The chatbot's entry as it is now (adopt, delete). */
  remoteText?: string;
  /** delete: was the entry linked by an older version that didn't track ownership? */
  legacy?: boolean;
  /** first-write: what would be written. */
  preview?: { action: 'add' | 'update' | 'remove'; text: string }[];
}

export const FIRST_WRITE = 'first-write';
export const MAX_ACTIVITY = 100;
const MAX_DECISIONS = 500;

export type ActivityKind =
  | 'added' // written to the chatbot
  | 'updated' // chatbot's copy changed to match an edit
  | 'removed' // taken off the chatbot
  | 'linked' // an entry the chatbot already had is now kept in sync
  | 'edited-there' // edited on the chatbot → memory edited
  | 'removed-there' // removed on the chatbot → memory no longer shared with it
  | 'imported'; // typed into OmniMemory's ChatGPT block → new memory

export interface ActivityEntry {
  id: string;
  at: string;
  kind: ActivityKind;
  text: string;
  memoryId: string | null;
  /** The memory's text before an edit made on the chatbot (for undo). */
  before?: string;
  undoneAt?: string;
}

export function addActivity(state: SiteSyncState, entries: Omit<ActivityEntry, 'id' | 'at'>[], now: Date): ActivityEntry[] {
  const at = now.toISOString();
  const fresh = entries.map((entry, index) => ({ ...entry, id: `${at}#${index}`, at, text: entry.text.slice(0, 500) }));
  return [...state.activity, ...fresh].slice(-MAX_ACTIVITY);
}

export function remember(list: string[], key: string): string[] {
  return [...list.filter((item) => item !== key), key].slice(-MAX_DECISIONS);
}

export function emptySyncState(site: SiteId): SiteSyncState {
  return {
    site,
    links: [],
    snapshot: null,
    lastSyncAt: null,
    lastError: null,
    notes: [],
    failures: [],
    inflight: null,
    cache: {},
    found: [],
    dismissed: [],
    accepted: [],
    approvedAt: null,
    approved: [],
    declined: [],
    held: [],
    activity: [],
  };
}

// ── Plans ────────────────────────────────────────────────────────────────

export type SyncOp =
  | { op: 'create'; memoryId: string; text: string }
  | { op: 'update'; memoryId: string; remoteId: string; text: string }
  | { op: 'delete'; memoryId: string | null; remoteId: string }
  | {
      op: 'set-block';
      lines: { memoryId: string; text: string }[];
      /** Memories that say the same as a line already written (not repeated). */
      covered?: { memoryId: string; text: string }[];
    };

/** A change to make inside OmniMemory because the chatbot's side changed. */
export type Pull =
  | { kind: 'edit'; memoryId: string; content: string }
  | { kind: 'unshare'; memoryId: string }
  | { kind: 'create'; content: string; remoteId: string | null; remoteText: string };

export interface OpResult {
  ok: boolean;
  /** items mode: the chatbot's id and text for a created/updated entry. */
  remoteId?: string;
  remoteText?: string;
  error?: string;
}

export interface Plan {
  ops: SyncOp[];
  pulls: Pull[];
  /** Links after adoption and clean-up, before any op runs. */
  links: SyncLink[];
  notes: string[];
  /**
   * Memories that are shareable but deliberately not written, so they don't
   * count as "waiting": they didn't fit (block mode), or are waiting on, or
   * covered by, a decision about an entry the chatbot already had.
   */
  leftOut?: string[];
  /** Changes waiting for the user's OK. */
  held: HeldChange[];
}

/** Loose comparison: Gemini, for one, adds a full stop to what it saves. */
export function sameMeaning(a: string, b: string): boolean {
  const clean = (text: string) => normalizeText(text).replace(/[.!。]+$/u, '').trim();
  return clean(a) === clean(b);
}

export function hasMarker(text: string): boolean {
  return text.includes(BLOCK_START) || text.includes(BLOCK_END);
}

/**
 * Tidy one line of block text: drop OmniMemory's markers and any list
 * punctuation left at either end (earlier versions could leave "- ; - …;").
 */
export function cleanLine(text: string): string {
  return text
    .split(BLOCK_START)
    .join(' ')
    .split(BLOCK_END)
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/^(?:\s*(?:[-–•*](?=\s|$)|;))+\s*/, '')
    .replace(/[\s;]+$/, '')
    .trim();
}

/** One memory as a single line in the ChatGPT block. Never contains a marker. */
export function blockLine(content: string): string {
  return cleanLine(content.replace(/\s*\n+\s*/g, '; '));
}

export function renderBlock(lines: string[]): string {
  return [BLOCK_START, ...lines.map((line) => `- ${line}`), BLOCK_END].join('\n');
}

const LIST_ROW = /^\s*(?:[-–•*](?=\s|$)|;|$)/;

/**
 * Split a free-text field into the user's own text and OmniMemory's lines.
 *
 * Tolerant of damage: several blocks, a block whose start marker was lost,
 * or marker text inside a line all end up as OmniMemory's, cleaned and
 * de-duplicated, so the next write replaces them with one clean block.
 * Rows outside OmniMemory's markers are the user's and are kept as they are.
 */
export function parseBlock(field: string): { outside: string; lines: string[]; present: boolean } {
  if (!hasMarker(field)) return { outside: field.trim(), lines: [], present: false };

  const rows = field.split('\n');
  const ours = rows.map(() => false);
  let inBlock = false;
  rows.forEach((row, index) => {
    const lastStart = row.lastIndexOf(BLOCK_START);
    const lastEnd = row.lastIndexOf(BLOCK_END);
    if (inBlock || lastStart >= 0 || lastEnd >= 0) ours[index] = true;
    if (!inBlock && lastEnd >= 0 && !row.includes(BLOCK_START)) {
      // An end marker with no start: the start was lost. The list rows just
      // above it belong to that block.
      for (let up = index - 1; up >= 0 && !ours[up] && LIST_ROW.test(rows[up]); up -= 1) ours[up] = true;
    }
    if (lastStart > lastEnd) inBlock = true;
    else if (lastEnd >= 0) inBlock = false;
  });

  const outside = rows
    .filter((_, index) => !ours[index])
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const lines: string[] = [];
  for (const row of rows.filter((_, index) => ours[index])) {
    const line = cleanLine(row);
    if (line && !lines.some((existing) => sameMeaning(existing, line))) lines.push(line);
  }
  return { outside, lines, present: true };
}

/**
 * Undo damage an earlier version could do to a memory's text (marker text
 * or list punctuation copied into it). Returns null when nothing is wrong.
 */
export function repairContent(content: string): string | null {
  if (!hasMarker(content) && !/^\s*;|;\s*$/.test(content)) return null;
  const parts: string[] = [];
  for (const piece of content.split(/\n|;(?=\s|$)/)) {
    const line = cleanLine(piece);
    if (line && !parts.some((existing) => sameMeaning(existing, line))) parts.push(line);
  }
  return parts.join('\n');
}

/** The managed part of a block-mode snapshot, read from the raw field. */
export function readBlockField(field: string): Pick<RemoteSnapshot, 'managed' | 'blockBudget' | 'needsRewrite'> & { outside: string } {
  const { outside, lines, present } = parseBlock(field);
  return {
    outside,
    managed: lines.map((text, index) => ({ id: `line-${index}`, text })),
    blockBudget: BLOCK_FIELD_LIMIT - (outside ? outside.length + 2 : 0),
    needsRewrite: present && composeBlockField(outside, lines) !== field,
  };
}

/** Put the block back into the field, after the user's own text. */
export function composeBlockField(outside: string, lines: string[]): string {
  if (lines.length === 0) return outside;
  return outside ? `${outside}\n\n${renderBlock(lines)}` : renderBlock(lines);
}

function looksSensitive(text: string): boolean {
  return findSensitive(text).length > 0;
}

function recentlyFailed(state: SiteSyncState, memoryId: string, text: string, now: Date): boolean {
  return state.failures.some(
    (failure) =>
      failure.memoryId === memoryId &&
      failure.text === text &&
      now.getTime() - new Date(failure.at).getTime() < FAILURE_BACKOFF_MS,
  );
}

/** Memories that should be on this chatbot right now, most useful first. */
function wanted(memories: Memory[], settings: Settings, site: SiteId): Memory[] {
  if (sharingBlock(settings, site) !== null) return [];
  return memories
    .filter((memory) => isShareableWith(memory, site) && !looksSensitive(memory.content))
    .sort((a, b) =>
      (b.last_used_at ?? b.updated_at).localeCompare(a.last_used_at ?? a.updated_at) ||
      a.created_at.localeCompare(b.created_at),
    );
}

/** May this chatbot be synced at all right now? */
export function syncBlocked(settings: Settings, site: SiteId): string | null {
  if (!SYNC_MODES[site]) return 'not-supported';
  if (!settings.siteSync[site]) return 'off';
  if (sharingBlock(settings, site) !== null) return 'paused';
  return null;
}

export interface PlanInput {
  site: SiteId;
  memories: Memory[];
  settings: Settings;
  state: SiteSyncState;
  remote: RemoteSnapshot;
  now: Date;
}

export function planSync(input: PlanInput): Plan {
  const mode = SYNC_MODES[input.site];
  if (!mode || syncBlocked(input.settings, input.site) !== null) {
    return { ops: [], pulls: [], links: input.state.links, notes: [], held: [] };
  }
  const plan = mode === 'items' ? planItems(input) : planBlock(input);
  if (input.state.approvedAt || plan.ops.length === 0) return plan;

  // Never written to this chatbot before: show what would happen and wait.
  return {
    ...plan,
    ops: [],
    held: [{ key: FIRST_WRITE, kind: 'first-write', preview: previewOps(plan.ops, input.remote) }, ...plan.held],
  };
}

/** What a set of ops would do, in words the dashboard can list. */
function previewOps(ops: SyncOp[], remote: RemoteSnapshot): NonNullable<HeldChange['preview']> {
  const preview: NonNullable<HeldChange['preview']> = [];
  for (const op of ops) {
    if (op.op === 'create') preview.push({ action: 'add', text: op.text });
    else if (op.op === 'update') preview.push({ action: 'update', text: op.text });
    else if (op.op === 'delete') {
      preview.push({ action: 'remove', text: remote.managed.find((entry) => entry.id === op.remoteId)?.text ?? 'An entry' });
    } else {
      const current = remote.managed.map((entry) => entry.text);
      for (const line of op.lines) {
        if (!current.some((text) => sameMeaning(text, line.text))) preview.push({ action: 'add', text: line.text });
      }
      for (const text of current) {
        if (!op.lines.some((line) => sameMeaning(line.text, text))) preview.push({ action: 'remove', text });
      }
    }
  }
  return preview;
}

function planItems({ site, memories, settings, state, remote, now }: PlanInput): Plan {
  const approved = new Set(state.approved);
  const declined = new Set(state.declined);
  const held: HeldChange[] = [];
  const leftOut: string[] = [];
  const byId = new Map(memories.map((memory) => [memory.id, memory]));
  const shareable = new Map(wanted(memories, settings, site).map((memory) => [memory.id, memory]));
  const remoteById = new Map(remote.managed.map((entry) => [entry.id, entry]));
  const linkedRemote = new Set<string>();

  const ops: SyncOp[] = [];
  const pulls: Pull[] = [];
  const links: SyncLink[] = [];

  for (const link of state.links) {
    const memory = byId.get(link.memoryId);
    const entry = link.remoteId ? remoteById.get(link.remoteId) : undefined;
    const isWanted = shareable.has(link.memoryId);

    if (!entry) {
      // Gone from the chatbot. If OmniMemory still wanted it there and hasn't
      // changed it since, the user removed it on purpose: stop sharing it.
      if (isWanted && memory && memory.content === link.pushedText) {
        pulls.push({ kind: 'unshare', memoryId: memory.id });
        shareable.delete(memory.id);
      }
      continue;
    }

    linkedRemote.add(entry.id);

    if (!isWanted || !memory) {
      links.push(link);
      const key = `delete:${entry.id}`;
      if (link.owned || approved.has(key)) {
        ops.push({ op: 'delete', memoryId: link.memoryId, remoteId: entry.id });
      } else {
        // The chatbot had this before OmniMemory (or an older version linked
        // it without noting who added it): ask before removing it.
        held.push({
          key,
          kind: 'delete',
          memoryId: link.memoryId,
          memoryText: memory?.content,
          remoteText: entry.text,
          legacy: link.owned === undefined,
        });
      }
      continue;
    }

    links.push(link);
    shareable.delete(memory.id);
    const localChanged = memory.content !== link.pushedText;
    const remoteChanged = entry.text !== link.remoteText;

    if (localChanged) {
      if (!recentlyFailed(state, memory.id, memory.content, now)) {
        ops.push({ op: 'update', memoryId: memory.id, remoteId: entry.id, text: memory.content });
      }
    } else if (remoteChanged && !looksSensitive(entry.text)) {
      const content = entry.text.slice(0, MAX_CONTENT_LENGTH).trim();
      if (content) pulls.push({ kind: 'edit', memoryId: memory.id, content });
    }
  }

  // Entries on the chatbot that OmniMemory doesn't know about yet.
  const unlinked = remote.managed.filter((entry) => !linkedRemote.has(entry.id));
  for (const entry of unlinked) {
    // Already there with the same wording: don't add a second copy. Linking
    // it would let OmniMemory edit and remove the chatbot's own entry, so
    // that waits for the user's OK.
    const match = [...shareable.values()].find((memory) => sameMeaning(memory.content, entry.text));
    if (match) {
      shareable.delete(match.id);
      const key = `adopt:${match.id}:${entry.id}`;
      // OmniMemory saved this itself but the chatbot didn't say under which id.
      const ours = approved.has(`own:${match.id}`);
      if (ours || approved.has(key)) {
        links.push({ memoryId: match.id, remoteId: entry.id, pushedText: match.content, remoteText: entry.text, owned: ours });
        continue;
      }
      leftOut.push(match.id);
      if (!declined.has(key)) {
        held.push({ key, kind: 'adopt', memoryId: match.id, memoryText: match.content, remoteText: entry.text });
      }
      continue;
    }
    // Anything else stays on the chatbot untouched. It's offered on the
    // Review page (see core/discover.ts) and only becomes a memory if the
    // user approves it.
  }

  for (const memory of shareable.values()) {
    if (recentlyFailed(state, memory.id, memory.content, now)) continue;
    ops.push({ op: 'create', memoryId: memory.id, text: memory.content });
  }

  return { ops, pulls, links, notes: [], leftOut, held };
}

function planBlock({ site, memories, settings, state, remote }: PlanInput): Plan {
  const byId = new Map(memories.map((memory) => [memory.id, memory]));
  const pulls: Pull[] = [];
  const notes: string[] = [];
  const current = remote.managed.map((entry) => entry.text);

  // 1. Work out what the user changed inside the block on ChatGPT's side,
  //    compared with what OmniMemory last wrote there.
  const unmatchedCurrent = current.filter((line) => !state.links.some((link) => sameMeaning(link.pushedText, line)));
  const removed = state.links.filter((link) => !current.some((line) => sameMeaning(line, link.pushedText)));

  if (removed.length === 1 && unmatchedCurrent.length === 1) {
    // One line swapped for another: an edit.
    const link = removed[0];
    const memory = byId.get(link.memoryId);
    const line = unmatchedCurrent[0];
    if (memory && blockLine(memory.content) === link.pushedText && !looksSensitive(line)) {
      pulls.push({ kind: 'edit', memoryId: memory.id, content: line.slice(0, MAX_CONTENT_LENGTH) });
    }
  } else {
    for (const link of removed) {
      const memory = byId.get(link.memoryId);
      if (memory && blockLine(memory.content) === link.pushedText && isShareableWith(memory, site)) {
        pulls.push({ kind: 'unshare', memoryId: memory.id });
      }
    }
    for (const line of unmatchedCurrent) {
      if (looksSensitive(line)) continue;
      if (memories.some((memory) => memory.status !== 'deleted' && sameMeaning(blockLine(memory.content), line))) continue;
      pulls.push({ kind: 'create', content: line.slice(0, MAX_CONTENT_LENGTH), remoteId: null, remoteText: line });
    }
  }

  // 2. The block OmniMemory wants, newest/most used first, within the limit.
  const budget = remote.blockBudget ?? BLOCK_FIELD_LIMIT;
  const lines: { memoryId: string; text: string }[] = [];
  let used = BLOCK_START.length + BLOCK_END.length + 2;
  const leftOut: string[] = [];
  const covered: { memoryId: string; text: string }[] = [];
  for (const memory of wanted(memories, settings, site)) {
    const text = blockLine(memory.content);
    if (!text) continue;
    if (lines.some((line) => sameMeaning(line.text, text))) {
      covered.push({ memoryId: memory.id, text });
      continue;
    }
    const cost = text.length + 3;
    if (used + cost > budget) {
      leftOut.push(memory.id);
      continue;
    }
    used += cost;
    lines.push({ memoryId: memory.id, text });
  }
  if (leftOut.length > 0) {
    const n = leftOut.length;
    notes.push(
      `${n} ${n === 1 ? 'memory doesn’t' : 'memories don’t'} fit in ChatGPT’s ${BLOCK_FIELD_LIMIT}-character limit, so ${n === 1 ? 'it was' : 'they were'} left out. The most recently used memories are kept.`,
    );
  }

  const desired = lines.map((line) => line.text);
  const same =
    !remote.needsRewrite && desired.length === current.length && desired.every((line, index) => line === current[index]);
  const links = [...lines, ...covered].map((line) => ({
    memoryId: line.memoryId,
    remoteId: null,
    pushedText: line.text,
    remoteText: line.text,
    owned: true,
  }));
  return {
    ops: same ? [] : [{ op: 'set-block', lines, covered }],
    pulls,
    // When the block already matches, adopt it as-is; otherwise the links are
    // replaced once the write succeeds (see applyResults).
    links: same ? links : state.links,
    notes,
    leftOut,
    held: [],
  };
}

/** Fold the results of running a plan's ops back into the sync state. */
export function applyResults(
  state: SiteSyncState,
  plan: Pick<Plan, 'ops' | 'links' | 'notes' | 'leftOut'>,
  results: OpResult[],
  now: Date,
): SiteSyncState {
  const at = now.toISOString();
  let links = [...plan.links];
  let failures = state.failures.filter((failure) => now.getTime() - new Date(failure.at).getTime() < FAILURE_BACKOFF_MS);
  const errors: string[] = [];
  const activity: Omit<ActivityEntry, 'id' | 'at'>[] = [];
  const owns: string[] = [];

  plan.ops.forEach((op, index) => {
    const result = results[index];
    if (!result) return;
    if (!result.ok) {
      errors.push(result.error ?? 'The chatbot refused a change.');
      if (op.op === 'create' || op.op === 'update') {
        failures = [
          ...failures.filter((failure) => failure.memoryId !== op.memoryId),
          { memoryId: op.memoryId, text: op.text, at, error: result.error ?? 'Refused' },
        ].slice(-MAX_FAILURES);
      }
      return;
    }
    switch (op.op) {
      case 'create':
        // Without the chatbot's id the entry can't be tracked; leave it
        // unlinked and the next sync will match it up by its wording (noting
        // that OmniMemory added it, so that doesn't need asking about).
        if (!result.remoteId) {
          owns.push(`own:${op.memoryId}`);
          activity.push({ kind: 'added', text: op.text, memoryId: op.memoryId });
          break;
        }
        links = links.filter((link) => link.memoryId !== op.memoryId);
        links.push({
          memoryId: op.memoryId,
          remoteId: result.remoteId,
          pushedText: op.text,
          remoteText: result.remoteText ?? op.text,
          owned: true,
        });
        failures = failures.filter((failure) => failure.memoryId !== op.memoryId);
        activity.push({ kind: 'added', text: op.text, memoryId: op.memoryId });
        break;
      case 'update':
        links = links.map((link) =>
          link.memoryId === op.memoryId
            ? { ...link, remoteId: result.remoteId ?? op.remoteId, pushedText: op.text, remoteText: result.remoteText ?? op.text }
            : link,
        );
        failures = failures.filter((failure) => failure.memoryId !== op.memoryId);
        activity.push({ kind: 'updated', text: op.text, memoryId: op.memoryId });
        break;
      case 'delete': {
        const gone = links.find((link) => link.remoteId === op.remoteId);
        links = links.filter((link) => link.remoteId !== op.remoteId);
        activity.push({ kind: 'removed', text: gone?.remoteText ?? gone?.pushedText ?? '', memoryId: op.memoryId });
        break;
      }
      case 'set-block': {
        const before = links;
        links = [...op.lines, ...(op.covered ?? [])].map((line) => ({
          memoryId: line.memoryId,
          remoteId: null,
          pushedText: line.text,
          remoteText: line.text,
          owned: true,
        }));
        for (const line of op.lines) {
          const old = before.find((link) => link.memoryId === line.memoryId);
          if (!old) activity.push({ kind: 'added', text: line.text, memoryId: line.memoryId });
          else if (!sameMeaning(old.pushedText, line.text)) activity.push({ kind: 'updated', text: line.text, memoryId: line.memoryId });
        }
        for (const old of before) {
          if (!links.some((link) => link.memoryId === old.memoryId)) {
            activity.push({ kind: 'removed', text: old.pushedText, memoryId: old.memoryId });
          }
        }
        break;
      }
    }
  });

  return {
    ...state,
    links,
    failures,
    activity: addActivity(state, activity, now),
    approved: owns.reduce(remember, state.approved),
    inflight: null,
    lastSyncAt: at,
    lastError: errors.length > 0 ? errors[0] : null,
    cache: { ...state.cache, leftOut: JSON.stringify(plan.leftOut ?? []) },
    notes: [
      ...plan.notes,
      ...(errors.length > 1 ? [`${errors.length} changes were refused by the chatbot.`] : []),
    ],
  };
}

/**
 * How many changes are waiting to be written, judged from OmniMemory's side
 * only (no network). Used to decide whether a sync needs to run.
 */
export function pendingChanges(site: SiteId, memories: Memory[], settings: Settings, state: SiteSyncState, now = new Date()): number {
  const mode = SYNC_MODES[site];
  if (!mode || syncBlocked(settings, site) !== null) return 0;
  const shareable = wanted(memories, settings, site);
  const byId = new Map(memories.map((memory) => [memory.id, memory]));
  const ids = new Set(shareable.map((memory) => memory.id));
  let count = 0;
  // Waiting on the user's OK: nothing to do until they decide.
  if (!state.approvedAt && state.held.some((change) => change.kind === 'first-write')) return 0;
  const heldDeletes = new Set(state.held.filter((change) => change.kind === 'delete').map((change) => change.key));

  for (const link of state.links) {
    const memory = byId.get(link.memoryId);
    if (!memory || !ids.has(link.memoryId)) {
      if (!heldDeletes.has(`delete:${link.remoteId}`)) count += 1;
      continue;
    }
    const text = mode === 'items' ? memory.content : blockLine(memory.content);
    if (text !== link.pushedText && !recentlyFailed(state, memory.id, memory.content, now)) count += 1;
  }
  const linked = new Set(state.links.map((link) => link.memoryId));
  // Block mode only has room for so much: memories that didn't fit last
  // time don't count as waiting.
  const leftOut = new Set<string>(safeJson(state.cache.leftOut));
  for (const memory of shareable) {
    if (linked.has(memory.id) || leftOut.has(memory.id)) continue;
    if (!recentlyFailed(state, memory.id, memory.content, now)) count += 1;
  }
  return count;
}

function safeJson(value: string | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** Tag the snapshot's entries with the OmniMemory memory they came from. */
export function labelSnapshot(entries: RemoteEntry[], links: SyncLink[], managed: RemoteSnapshot['managed']): RemoteEntry[] {
  const byRemoteId = new Map(links.filter((link) => link.remoteId).map((link) => [link.remoteId as string, link.memoryId]));
  return entries.map((entry) => {
    const managedEntry = managed.find((item) => item.id === entry.id);
    const memoryId =
      byRemoteId.get(entry.id) ??
      (managedEntry ? links.find((link) => sameMeaning(link.pushedText, managedEntry.text))?.memoryId : undefined);
    return memoryId ? { ...entry, memoryId } : entry;
  });
}
