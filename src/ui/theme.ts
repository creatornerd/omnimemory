import { SITE_IDS, type SiteId, type ThemeSetting } from '../core/types';

const STORAGE_KEY = 'omni:theme';
const COLORS_KEY = 'omni:site-colors';

/** Apply a theme to this document. "system" removes the override. */
export function applyTheme(theme: ThemeSetting): void {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable; the theme still applies for this page.
  }
}

/**
 * Apply the last known theme before React renders, so an explicit light/dark
 * choice does not flash the system theme first. The authoritative value is in
 * Settings; this mirror is only a paint-time hint.
 */
export function bootTheme(): void {
  bootSiteColors();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') document.documentElement.dataset.theme = stored;
  } catch {
    // ignore
  }
}

/** Use the user's chatbot colours on this page (see SITES[site].color). */
export function applySiteColors(colors: Record<SiteId, string>): void {
  const root = document.documentElement;
  for (const site of SITE_IDS) root.style.setProperty(`--om-site-${site}`, colors[site]);
  try {
    localStorage.setItem(COLORS_KEY, JSON.stringify(colors));
  } catch {
    // ignore
  }
}

/** Paint-time hint so custom colours don't flash the defaults first. */
export function bootSiteColors(): void {
  try {
    const stored = JSON.parse(localStorage.getItem(COLORS_KEY) ?? 'null') as Record<string, unknown> | null;
    if (!stored) return;
    for (const site of SITE_IDS) {
      const value = stored[site];
      if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) {
        document.documentElement.style.setProperty(`--om-site-${site}`, value);
      }
    }
  } catch {
    // ignore
  }
}
