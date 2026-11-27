import {
  MemoryError,
  buildContext,
  describeSensitive,
  findSensitive,
  findSimilar,
  isShareableWith,
  rankByRelevance,
  searchMemories,
  shareableMemories,
  sharingBlock,
  normalizeText,
  suggestCategory,
  withoutContext,
  type Memory,
  type MemoryAssistant,
  type MemoryService,
  type Settings,
  type SiteId,
} from '../core';
import type { SyncService } from '../core/sync-service';
import {
  parseRequestWithReason,
  type ContextResult,
  type DashboardView,
  type FitResult,
  type QueryResult,
  type Request,
  type Response,
  type ReviewResult,
  type SharedMemory,
  type SuggestResult,
} from '../shared/messages';

/**
 * Handles requests from content scripts. Kept free of chrome.* so the whole
 * permission model can be exercised in unit tests.
 *
 * Rules enforced here, regardless of what the page-side code does:
 *  - the site is whatever the browser says the sender is;
 *  - a site can only read memories it is allowed to receive right now;
 *  - a site can only modify memories it can currently read;
 *  - text that looks like a credential is never stored.
 */

export interface RouterDeps {
  service: MemoryService;
  openDashboard: (view: DashboardView) => void | Promise<void>;
  /** Chatbot memory sync. Optional so tests of the rest can leave it out. */
  sync?: SyncService;
  /** Told when a tab finishes a sync (so a background sync tab can close). */
  onSyncFinished?: (site: SiteId) => void;
  /** The optional AI assistant (null when it's off). Its key never leaves the extension. */
  assistant?: (settings: Settings) => MemoryAssistant | null;
}

function requireSync(deps: RouterDeps): SyncService {
  if (!deps.sync) throw new MemoryError('Sync is not available.', 'state');
  return deps.sync;
}

const MAX_RESULTS = 60;

/**
 * Recent "which memories fit" answers, so the bar above the message box and
 * the panel share one Gemini request for the same draft.
 */
const fitCache = new Map<string, { at: number; ids: string[]; by: FitResult['by'] }>();
const FIT_CACHE_MS = 10 * 60 * 1000;
const MAX_FIT_WORDS = 3;

function libraryStamp(memories: Memory[]): string {
  let latest = '';
  for (const memory of memories) if (memory.updated_at > latest) latest = memory.updated_at;
  return `${memories.length}:${latest}`;
}

/** Memories that share enough words with what's being typed (on this device). */
function fitByWords(memories: Memory[], draft: string, recent: string): Memory[] {
  // What's typed matters most; the chat before it only when the draft finds nothing.
  for (const text of [draft, `${recent} ${draft}`]) {
    if (!text.trim()) continue;
    const found = rankByRelevance(memories, text).filter((r) => r.relevant);
    if (found.length > 0) return found.slice(0, MAX_FIT_WORDS).map((r) => r.memory);
  }
  return [];
}

/** How long a hide or delete made from a chatbot page can be taken back from there. */
const UNDO_MS = 5 * 60 * 1000;

/** Hides and deletes made from chatbot pages, so that same page can undo them. */
const recentRemovals = new Map<string, { site: SiteId; kind: 'unshare' | 'delete'; at: number }>();

function noteRemoval(id: string, site: SiteId, kind: 'unshare' | 'delete'): void {
  const now = Date.now();
  for (const [key, entry] of recentRemovals) if (now - entry.at > UNDO_MS) recentRemovals.delete(key);
  recentRemovals.set(id, { site, kind, at: now });
}

function toShared(memory: Memory): SharedMemory {
  return {
    id: memory.id,
    content: memory.content,
    category: memory.category,
    tags: memory.tags,
    updated_at: memory.updated_at,
    source: memory.source,
  };
}

/** Load a memory only if the calling site is currently allowed to see it. */
async function visibleMemory(service: MemoryService, site: SiteId, id: string): Promise<Memory> {
  const [memory, settings] = await Promise.all([service.get(id), service.getSettings()]);
  if (!memory || sharingBlock(settings, site) !== null || !isShareableWith(memory, site)) {
    // Same error whether it is missing, deleted or just not shared: do not
    // reveal the existence of memories the site may not see.
    throw new MemoryError('That memory is not available here.', 'not-found');
  }
  return memory;
}

function refuseSensitive(content: string): void {
  const findings = findSensitive(content);
  if (findings.length > 0) {
    throw new MemoryError(
      `${describeSensitive(findings)} OmniMemory does not store credentials.`,
      'invalid',
    );
  }
}

async function dispatch(request: Request, site: SiteId, deps: RouterDeps): Promise<unknown> {
  const { service } = deps;

  switch (request.type) {
    case 'context/query': {
      const [library, settings] = await Promise.all([service.library(), service.getSettings()]);
      const blocked = sharingBlock(settings, site);
      const shareable = shareableMemories(library, settings, site);
      const pageText = settings.relevanceFromPage ? request.pageText : '';
      const ranked = rankByRelevance(shareable, `${request.query} ${pageText}`);
      const relevantIds = new Set(ranked.filter((r) => r.relevant).map((r) => r.memory.id));

      const ordered = request.query.trim()
        ? searchMemories(shareable, request.query)
        : ranked.map((r) => r.memory);

      const result: QueryResult = {
        site,
        color: settings.siteColors[site],
        blocked,
        total: shareable.length,
        items: ordered.slice(0, MAX_RESULTS).map((memory) => ({
          memory: toShared(memory),
          relevant: relevantIds.has(memory.id),
        })),
        ai: !!deps.assistant?.(settings),
        shareDefaults: settings.sourceDefaults[site] ?? settings.defaultPermissions,
        syncOn: settings.siteSync[site],
      };
      return result;
    }

    case 'context/fit': {
      const [library, settings] = await Promise.all([service.library(), service.getSettings()]);
      const shareable = shareableMemories(library, settings, site);
      const draft = withoutContext(request.draft).replace(/\s+/g, ' ').trim();
      const recent = withoutContext(request.recent).replace(/\s+/g, ' ').trim();
      if (!settings.relevanceFromPage || shareable.length === 0 || (!draft && !recent)) {
        return { items: [], by: 'words' } satisfies FitResult;
      }
      const byId = new Map(shareable.map((memory) => [memory.id, memory]));
      const assistant = settings.aiMatching ? deps.assistant?.(settings) : null;
      const key = [site, assistant ? 'ai' : 'words', libraryStamp(shareable), draft, recent].join('\u0000');
      const now = Date.now();
      for (const [k, entry] of fitCache) if (now - entry.at > FIT_CACHE_MS) fitCache.delete(k);
      const cached = fitCache.get(key);
      if (cached) {
        return { items: cached.ids.flatMap((id) => byId.get(id) ?? []).map(toShared), by: cached.by } satisfies FitResult;
      }
      let picked: Memory[] | null = null;
      let by: FitResult['by'] = 'words';
      if (assistant) {
        try {
          picked = await assistant.pickFitting(draft, recent, shareable);
          by = 'ai';
        } catch {
          picked = null; // busy or used up: match words instead, and don't remember that
        }
      }
      const items = picked ?? fitByWords(shareable, draft, recent);
      if (picked) {
        fitCache.set(key, { at: now, ids: items.map((memory) => memory.id), by });
        if (fitCache.size > 40) fitCache.delete(fitCache.keys().next().value as string);
      }
      return { items: items.map(toShared), by } satisfies FitResult;
    }

    case 'ai/suggest': {
      const [library, settings] = await Promise.all([service.library(), service.getSettings()]);
      const assistant = deps.assistant?.(settings);
      if (!assistant) throw new MemoryError('Turn on the AI assistant in OmniMemory’s settings first.', 'state');
      try {
        const { suggestions } = await assistant.suggestFromChat(request.conversation, library);
        // Anything the text rules find in the library (private memories included) is left out, and counted;
        // the model's own count of what it skipped isn't reliable enough to show.
        const fresh = suggestions.filter((s) => !findSimilar(s.text, library).some((match) => match.kind === 'duplicate'));
        const result: SuggestResult = { suggestions: fresh, alreadyHave: suggestions.length - fresh.length };
        return result;
      } catch (error) {
        if (error instanceof MemoryError) throw error;
        throw new MemoryError(error instanceof Error ? error.message : 'The AI couldn’t answer.', 'state');
      }
    }

    case 'context/build': {
      // Built here, from fresh data, so a memory deleted or unshared a moment
      // ago can never ride along in a stale selection.
      const [library, settings] = await Promise.all([service.library(), service.getSettings()]);
      const allowed = new Map(shareableMemories(library, settings, site).map((m) => [m.id, m]));
      const chosen = request.ids.flatMap((id) => allowed.get(id) ?? []);
      const result: ContextResult = buildContext(chosen);
      return result;
    }

    case 'context/used': {
      const [library, settings] = await Promise.all([service.library(), service.getSettings()]);
      const allowed = new Set(shareableMemories(library, settings, site).map((m) => m.id));
      await service.markUsed(request.ids.filter((id) => allowed.has(id)));
      return null;
    }

    case 'memory/review': {
      // Only compare against memories this site can already see, so the
      // warning itself cannot leak unshared content.
      const [library, settings] = await Promise.all([service.library(), service.getSettings()]);
      const visible = shareableMemories(library, settings, site);
      const result: ReviewResult = {
        suggestedCategory: suggestCategory(request.content),
        sensitive: describeSensitive(findSensitive(request.content)),
        similar: findSimilar(request.content, visible)
          .slice(0, 3)
          .map((match) => ({ kind: match.kind, reason: match.reason, content: match.memory.content })),
      };
      return result;
    }

    case 'memory/create': {
      refuseSensitive(request.content);
      // The same words twice is never useful. Only memories this page can
      // already see are compared, so the refusal can't reveal anything else.
      const [library, settings] = await Promise.all([service.library(), service.getSettings()]);
      const wanted = normalizeText(request.content).replace(/[.!?]+$/, '');
      const twin = shareableMemories(library, settings, site).find(
        (memory) => normalizeText(memory.content).replace(/[.!?]+$/, '') === wanted,
      );
      if (twin) throw new MemoryError('You already have this memory.', 'invalid');
      const memory = await service.create({
        content: request.content,
        category: request.category,
        tags: request.tags,
        source: site,
        permissions: request.permissions,
      });
      return toShared(memory);
    }

    case 'memory/update': {
      await visibleMemory(service, site, request.id);
      refuseSensitive(request.content);
      return toShared(await service.update(request.id, { content: request.content }));
    }

    case 'memory/unshare': {
      await visibleMemory(service, site, request.id);
      await service.update(request.id, { permissions: { [site]: false } });
      noteRemoval(request.id, site, 'unshare');
      return null;
    }

    case 'memory/delete': {
      await visibleMemory(service, site, request.id);
      await service.remove([request.id]);
      noteRemoval(request.id, site, 'delete');
      return null;
    }

    case 'memory/undo': {
      // Only what this same chatbot hid or deleted in the last few minutes.
      const entry = recentRemovals.get(request.id);
      if (!entry || entry.site !== site || Date.now() - entry.at > UNDO_MS) {
        throw new MemoryError('That can’t be undone from here any more. Use the memory manager.', 'not-found');
      }
      recentRemovals.delete(request.id);
      if (entry.kind === 'delete') await service.restore([request.id]);
      else await service.update(request.id, { permissions: { [site]: true } });
      return null;
    }

    case 'ui/open-dashboard': {
      await deps.openDashboard(request.view);
      return null;
    }

    // ── Chatbot memory sync. The site is always the sender's own site, so a
    //    page can only ever read or change its own chatbot's sync state.
    case 'sync/status':
      return requireSync(deps).status(site);

    case 'sync/begin':
      return requireSync(deps).begin(site, request.remote);

    case 'sync/commit':
      return requireSync(deps).commit(site, request.planId, request.results, request.after);

    case 'sync/fail':
      await requireSync(deps).fail(site, request.planId, request.message);
      return null;

    case 'sync/done':
      deps.onSyncFinished?.(site);
      return null;

    case 'sync/cache':
      await requireSync(deps).setCache(site, request.key, request.value);
      return null;
  }
}

/**
 * Entry point. `site` must come from the browser-provided sender (see
 * background/index.ts); null means "not a supported chatbot page".
 */
export async function handleRequest(
  raw: unknown,
  site: SiteId | null,
  deps: RouterDeps,
): Promise<Response> {
  if (site === null) return { ok: false, error: 'OmniMemory is not available on this page.' };
  const parsed = parseRequestWithReason(raw);
  if ('error' in parsed) return { ok: false, error: `Unrecognised request (${parsed.error}).` };
  const { request } = parsed;
  try {
    return { ok: true, data: await dispatch(request, site, deps) };
  } catch (error) {
    if (error instanceof MemoryError) return { ok: false, error: error.message };
    console.error('[OmniMemory] request failed', error);
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}
