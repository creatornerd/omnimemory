import type { SiteId } from '../../core/types';
import { siteFromUrl } from '../../shared/sites';
import { chatgptAdapter } from './chatgpt';
import { claudeAdapter } from './claude';
import { geminiAdapter } from './gemini';
import type { SiteAdapter } from './types';

export type { SiteAdapter } from './types';

/** To support another chatbot, add its adapter here (and to shared/sites.ts). */
export const ADAPTERS: Record<SiteId, SiteAdapter> = {
  chatgpt: chatgptAdapter,
  claude: claudeAdapter,
  gemini: geminiAdapter,
};

export function adapterForUrl(url: string): SiteAdapter | null {
  const site = siteFromUrl(url);
  return site ? ADAPTERS[site] : null;
}
