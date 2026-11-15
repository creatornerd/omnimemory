import type { ThemeSetting } from '../core/types';

const STORAGE_KEY = 'omni:theme';

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
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') document.documentElement.dataset.theme = stored;
  } catch {
    // ignore
  }
}
