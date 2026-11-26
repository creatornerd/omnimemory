import { DEFAULT_SITE_COLORS, type SiteId, type Source } from '../core/types';

export interface SiteInfo {
  id: SiteId;
  label: string;
  /** Exact hostnames this site is served from. */
  hosts: string[];
  /**
   * The chatbot's colour as a CSS value. It reads the user's choice from
   * --om-site-<id> (set by applySiteColors) and falls back to the default.
   */
  color: string;
}

/**
 * Registry of supported chatbots. Adding a provider means: one entry here,
 * one adapter in src/content/adapters, one match pattern in the manifest.
 */
export const SITES: Record<SiteId, SiteInfo> = {
  chatgpt: { id: 'chatgpt', label: 'ChatGPT', hosts: ['chatgpt.com'], color: `var(--om-site-chatgpt, ${DEFAULT_SITE_COLORS.chatgpt})` },
  claude: { id: 'claude', label: 'Claude', hosts: ['claude.ai'], color: `var(--om-site-claude, ${DEFAULT_SITE_COLORS.claude})` },
  gemini: { id: 'gemini', label: 'Gemini', hosts: ['gemini.google.com'], color: `var(--om-site-gemini, ${DEFAULT_SITE_COLORS.gemini})` },
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

/** Shown wherever the chatbots are named prominently. */
export const TRADEMARK_NOTICE =
  'ChatGPT is a trademark of OpenAI. Claude is a trademark of Anthropic. Gemini is a trademark of Google LLC. OmniMemory is an independent project and isn’t affiliated with, endorsed by or sponsored by any of them.';
