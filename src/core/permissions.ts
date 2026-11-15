import type { Memory, Settings, SiteId } from './types';

/**
 * The single place that decides whether a memory may leave the extension.
 * Every retrieval path for a chatbot goes through these functions.
 */

export type SharingBlock = 'global-pause' | 'site-pause' | null;

/** Is retrieval switched off for this chatbot as a whole? */
export function sharingBlock(settings: Settings, site: SiteId): SharingBlock {
  if (settings.sharingPaused) return 'global-pause';
  if (settings.sitePaused[site]) return 'site-pause';
  return null;
}

/** May this specific memory be shown to / inserted into this chatbot? */
export function isShareableWith(memory: Memory, site: SiteId): boolean {
  return memory.status === 'active' && memory.enabled && memory.permissions[site] === true;
}

/** All memories a chatbot may currently receive. Empty while paused. */
export function shareableMemories(memories: Memory[], settings: Settings, site: SiteId): Memory[] {
  if (sharingBlock(settings, site) !== null) return [];
  return memories.filter((memory) => isShareableWith(memory, site));
}

export type SharingSummary = 'private' | 'all' | 'some' | 'none';

/** One-word description of a memory's sharing state, for filters and badges. */
export function sharingSummary(memory: Memory): SharingSummary {
  if (!memory.enabled) return 'private';
  const allowed = Object.values(memory.permissions).filter(Boolean).length;
  if (allowed === 0) return 'none';
  return allowed === Object.keys(memory.permissions).length ? 'all' : 'some';
}
