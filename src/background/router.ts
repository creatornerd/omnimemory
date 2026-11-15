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
  suggestCategory,
  type Memory,
  type MemoryService,
  type SiteId,
} from '../core';
import type { SyncService } from '../core/sync-service';
import {
  parseRequestWithReason,
  type ContextResult,
  type DashboardView,
  type QueryResult,
  type Request,
  type Response,
  type ReviewResult,
  type SharedMemory,
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
}

function requireSync(deps: RouterDeps): SyncService {
  if (!deps.sync) throw new MemoryError('Sync is not available.', 'state');
  return deps.sync;
}

const MAX_RESULTS = 60;

function toShared(memory: Memory): SharedMemory {
  return {
    id: memory.id,
    content: memory.content,
    category: memory.category,
    tags: memory.tags,
    updated_at: memory.updated_at,
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
        blocked,
        total: shareable.length,
        items: ordered.slice(0, MAX_RESULTS).map((memory) => ({
          memory: toShared(memory),
          relevant: relevantIds.has(memory.id),
        })),
      };
      return result;
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
      const memory = await service.create({
        content: request.content,
        category: request.category,
        tags: request.tags,
        source: site,
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
      return null;
    }

    case 'memory/delete': {
      await visibleMemory(service, site, request.id);
      await service.remove([request.id]);
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
