import { MAX_CONTENT_LENGTH, isSiteId } from '../core/types';
import { getAssistant, getService, getSyncService, openDashboard, setPendingCapture } from '../shared/platform';
import { siteFromUrl } from '../shared/sites';
import { handleRequest } from './router';
import { closeStaleBackgroundTabs, finishBackgroundTab, scheduleSync, syncSite, updateBadge } from './sync-scheduler';

/**
 * Service worker. It owns nothing but wiring:
 *  - answers content-script requests through the validated router;
 *  - opens the welcome tour after a fresh install;
 *  - offers "Save to OmniMemory" on the right-click menu for selected text;
 *  - clears out trash older than 30 days;
 *  - decides when each chatbot's own memory needs syncing (the requests to
 *    the chatbot are made by the content script on that chatbot's site).
 *
 * Its only network requests are the optional AI assistant's (to Gemini, when
 * the user presses "Suggest from this chat"); the key never reaches a page.
 */

const MENU_ID = 'omnimemory-save-selection';

chrome.runtime.onInstalled.addListener((details) => {
  // First install: open the dashboard with the welcome tour.
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html#/welcome') });
  }
  // removeAll first, so an update doesn't try to add the same menu twice.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Save selection to OmniMemory…',
      contexts: ['selection'],
    });
  });
  void getService().purgeExpired();
});

chrome.runtime.onStartup.addListener(() => {
  void getService().purgeExpired();
});

void closeStaleBackgroundTabs();
void updateBadge();

// Any change to memories or settings (from any context) may need syncing.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'omni:revision' in changes) scheduleSync();
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== MENU_ID) return;
  const text = (info.selectionText ?? '').trim().slice(0, MAX_CONTENT_LENGTH);
  if (!text) return;
  // Nothing is saved here. The text waits in session storage until the user
  // reviews it in the popup (or the dashboard, if the popup cannot open).
  void (async () => {
    await setPendingCapture(text);
    try {
      await chrome.action.openPopup();
    } catch {
      await openDashboard('library');
    }
  })();
});

// chrome-extension://<id>/ in Chrome, moz-extension://<uuid>/ in Firefox.
const extensionOrigin = chrome.runtime.getURL('');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;

  // From the dashboard or popup: "sync this chatbot now".
  if (sender.url?.startsWith(extensionOrigin)) {
    const request = message as { type?: unknown; site?: unknown } | null;
    if (request?.type === 'omni/sync-run' && isSiteId(request.site)) {
      syncSite(request.site, true, true)
        .then((how) => sendResponse({ ok: true, data: how }))
        .catch(() => sendResponse({ ok: false, error: 'Could not start a sync.' }));
      return true;
    }
    return false;
  }

  // Otherwise only our own content scripts, running in the top frame of a tab.
  if (!sender.tab || sender.frameId !== 0) return false;

  // The site comes from the browser, not from the message.
  const site = siteFromUrl(sender.url ?? sender.tab.url);
  handleRequest(message, site, {
    service: getService(),
    sync: getSyncService(),
    openDashboard,
    onSyncFinished: (finished) => void finishBackgroundTab(finished),
    assistant: getAssistant,
  })
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false, error: 'Something went wrong. Please try again.' }));
  return true; // keep the channel open for the async response
});
