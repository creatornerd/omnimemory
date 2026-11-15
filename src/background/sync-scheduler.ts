import { SITE_IDS, SYNC_MODES, type SiteId } from '../core';
import { getService, getSyncService } from '../shared/platform';

/**
 * Decides when each chatbot's own memory needs syncing, and makes sure a tab
 * of that chatbot does it. The actual reading and writing happens in the
 * content script on the chatbot's site (see content/sync/runner.ts).
 *
 *  - A tab of the chatbot is open → ask it to sync now.
 *  - None is open → if "sync in the background" is on, open the chatbot in
 *    a background tab, let it sync, and close it again.
 */

const PAGES: Record<SiteId, { match: string; open: string }> = {
  chatgpt: { match: 'https://chatgpt.com/*', open: 'https://chatgpt.com/' },
  gemini: { match: 'https://gemini.google.com/*', open: 'https://gemini.google.com/app' },
  claude: { match: 'https://claude.ai/*', open: 'https://claude.ai/' },
};

const SYNC_TABS_KEY = 'omni:syncTabs';
const BACKGROUND_TAB_TIMEOUT_MS = 90 * 1000;

let timer: ReturnType<typeof setTimeout> | undefined;

type SyncTabs = Partial<Record<SiteId, { tabId: number; at: number }>>;

async function syncTabs(): Promise<SyncTabs> {
  const stored = await chrome.storage.session.get(SYNC_TABS_KEY);
  return (stored[SYNC_TABS_KEY] as SyncTabs | undefined) ?? {};
}

async function setSyncTab(site: SiteId, value: { tabId: number; at: number } | null): Promise<void> {
  const tabs = await syncTabs();
  if (value) tabs[site] = value;
  else delete tabs[site];
  await chrome.storage.session.set({ [SYNC_TABS_KEY]: tabs });
}

/** Close a background tab OmniMemory opened, once it has finished. */
export async function finishBackgroundTab(site: SiteId): Promise<void> {
  const entry = (await syncTabs())[site];
  if (!entry) return;
  await setSyncTab(site, null);
  await chrome.tabs.remove(entry.tabId).catch(() => {});
}

/** Close any background sync tab left over from a worker that went away. */
export async function closeStaleBackgroundTabs(): Promise<void> {
  const tabs = await syncTabs();
  for (const site of Object.keys(tabs) as SiteId[]) {
    const entry = tabs[site];
    if (entry && Date.now() - entry.at > BACKGROUND_TAB_TIMEOUT_MS) await finishBackgroundTab(site);
  }
}

/** Get one chatbot synced now. `refresh` also re-reads everything it remembers. */
export async function syncSite(site: SiteId, refresh = false, userAsked = false): Promise<'tab' | 'background' | 'none'> {
  if (!SYNC_MODES[site]) return 'none';
  const open = await chrome.tabs.query({ url: PAGES[site].match });
  const background = (await syncTabs())[site];
  const candidates = open.filter((tab) => tab.id !== undefined && !tab.discarded);
  for (const tab of candidates) {
    try {
      await chrome.tabs.sendMessage(tab.id as number, { type: 'omni/sync-now', refresh });
      return 'tab';
    } catch {
      // That tab has no OmniMemory content script yet (still loading, or
      // opened before the extension was installed). Try the next one.
    }
  }
  if (background) return 'background'; // already on its way

  const settings = await getService().getSettings();
  if (!settings.syncInBackground && !userAsked) return 'none';
  const tab = await chrome.tabs.create({ url: PAGES[site].open, active: false });
  if (tab.id === undefined) return 'none';
  await setSyncTab(site, { tabId: tab.id, at: Date.now() });
  setTimeout(() => void finishBackgroundTab(site), BACKGROUND_TAB_TIMEOUT_MS);
  return 'background';
}

/** Something changed: after a short pause, sync every chatbot that is behind. */
export function scheduleSync(delay = 2500): void {
  clearTimeout(timer);
  timer = setTimeout(() => {
    void syncWhatIsBehind();
    void updateBadge();
  }, delay);
}

/** Show how many things are waiting on the Review page on the toolbar icon. */
export async function updateBadge(): Promise<void> {
  try {
    const sync = getSyncService();
    const [found, held] = await Promise.all([sync.allFound(), sync.allHeld()]);
    const count = found.length + held.length;
    // Amber when a sync change is waiting for an OK, blue for review finds.
    await chrome.action.setBadgeBackgroundColor({ color: held.length > 0 ? '#b45309' : '#2f6fed' });
    await chrome.action.setBadgeText({ text: count === 0 ? '' : count > 99 ? '99+' : String(count) });
    const parts = [
      ...(held.length > 0 ? [`${held.length} sync ${held.length === 1 ? 'change needs' : 'changes need'} your OK`] : []),
      ...(found.length > 0 ? [`${found.length} found on your chatbots to review`] : []),
    ];
    await chrome.action.setTitle({ title: parts.length === 0 ? 'OmniMemory' : `OmniMemory — ${parts.join(' · ')}` });
  } catch {
    // The badge is a nicety; never let it break syncing.
  }
}

async function syncWhatIsBehind(): Promise<void> {
  const sync = getSyncService();
  for (const site of SITE_IDS) {
    if (!SYNC_MODES[site]) continue;
    try {
      const status = await sync.status(site);
      if (status.blocked || status.pending === 0) continue;
      await syncSite(site);
    } catch (error) {
      console.warn('[OmniMemory] could not schedule a sync for', site, error);
    }
  }
}
