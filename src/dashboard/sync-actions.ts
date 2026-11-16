import type { SiteId } from '../core';
import { isExtension } from '../shared/platform';
import { SITES } from '../shared/sites';

/** Ask the service worker to sync one chatbot now. Resolves to a status message. */
export async function requestSync(site: SiteId): Promise<string> {
  if (!isExtension()) throw new Error('Syncing only works in the installed extension.');
  const response = (await chrome.runtime.sendMessage({ type: 'omni/sync-run', site })) as
    | { ok: true; data: 'tab' | 'background' | 'none' }
    | { ok: false; error: string }
    | undefined;
  if (!response?.ok) throw new Error(response?.error ?? 'Could not start a sync.');
  return response.data === 'background'
    ? `Opening ${SITES[site].label} in a background tab to sync…`
    : `Syncing with ${SITES[site].label}…`;
}
