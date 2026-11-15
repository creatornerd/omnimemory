import type { SiteId, Source } from '../core/types';

export interface SiteInfo {
  id: SiteId;
  label: string;
  /** Exact hostnames this site is served from. */
  hosts: string[];
  /** Brand-adjacent dot colour used in sharing toggles. */
  color: string;
}

/**
 * Registry of supported chatbots. Adding a provider means: one entry here,
 * one adapter in src/content/adapters, one match pattern in the manifest.
 */
export const SITES: Record<SiteId, SiteInfo> = {
  chatgpt: { id: 'chatgpt', label: 'ChatGPT', hosts: ['chatgpt.com'], color: '#10a37f' },
  claude: { id: 'claude', label: 'Claude', hosts: ['claude.ai'], color: '#d97757' },
  gemini: { id: 'gemini', label: 'Gemini', hosts: ['gemini.google.com'], color: '#4c8df6' },
};

export const SITE_LIST: SiteInfo[] = Object.values(SITES);

/** Map a page URL to a supported site. HTTPS and exact host match only. */
export function siteFromUrl(url: string | undefined | null): SiteId | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    const match = SITE_LIST.find((site) => site.hosts.includes(parsed.hostname));
    return match?.id ?? null;
  } catch {
    return null;
  }
}

const SOURCE_LABELS: Record<Source, string> = {
  manual: 'Added manually',
  chatgpt: 'Saved on ChatGPT',
  claude: 'Saved on Claude',
  gemini: 'Saved on Gemini',
  selection: 'Saved from a page',
  import: 'Imported',
};

export function sourceLabel(source: Source): string {
  return SOURCE_LABELS[source] ?? source;
}
