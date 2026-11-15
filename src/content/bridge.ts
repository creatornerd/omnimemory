import type { SiteId } from '../core/types';
import type { Request, Response, ResponseMap } from '../shared/messages';

/** Thrown when the extension was reloaded/updated underneath an open page. */
export class ExtensionGone extends Error {
  constructor() {
    super('OmniMemory was updated. Reload this page to keep using it.');
    this.name = 'ExtensionGone';
  }
}

/** Dev-server only: lets the fixture page pretend to be a given site. */
let devSite: SiteId | null = null;
export function setDevSite(site: SiteId): void {
  devSite = site;
}

function hasRuntime(): boolean {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

/**
 * Ask the service worker to do something. This is the content script's only
 * way to reach memory data — it has no database access of its own.
 */
export async function send<K extends Request['type']>(
  request: Extract<Request, { type: K }>,
): Promise<ResponseMap[K]> {
  let response: Response | undefined;

  if (hasRuntime()) {
    try {
      response = (await chrome.runtime.sendMessage(request)) as Response | undefined;
    } catch {
      throw new ExtensionGone();
    }
  } else if (import.meta.env.DEV) {
    // No extension runtime (Vite dev fixture): call the same router in-page.
    const [{ handleRequest }, { getService, openDashboard }] = await Promise.all([
      import('../background/router'),
      import('../shared/platform'),
    ]);
    response = await handleRequest(request, devSite, { service: getService(), openDashboard });
  } else {
    throw new ExtensionGone();
  }

  if (!response) throw new ExtensionGone();
  if (!response.ok) throw new Error(response.error);
  return response.data as ResponseMap[K];
}
