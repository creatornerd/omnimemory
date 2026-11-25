import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import type { ThemeSetting } from '../../core/types';
import { cx } from '../format';

function systemDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

/** Whether the page is dark right now, following the system while the setting is "system". */
function useIsDark(theme: ThemeSetting): boolean {
  const [system, setSystem] = useState(systemDark);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) return;
    const onChange = () => setSystem(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return theme === 'dark' || (theme === 'system' && system);
}

/**
 * One-click switch between light and dark. Settings → Appearance still offers
 * "System" to follow the computer again.
 */
export function ThemeToggle({
  theme,
  onChange,
  variant = 'icon',
}: {
  theme: ThemeSetting;
  onChange: (theme: ThemeSetting) => void;
  /** "icon" for tight headers, "row" for the dashboard sidebar. */
  variant?: 'icon' | 'row';
}) {
  const dark = useIsDark(theme);
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  const icon = dark ? <Sun size={15} /> : <Moon size={15} />;

  if (variant === 'row') {
    return (
      <button
        type="button"
        onClick={() => onChange(dark ? 'light' : 'dark')}
        aria-label={label}
        title={label}
        className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] text-ink-2 transition-colors hover:bg-muted/60 hover:text-ink"
      >
        {icon}
        <span className="flex-1">{dark ? 'Light mode' : 'Dark mode'}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onChange(dark ? 'light' : 'dark')}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-[30px] shrink-0 items-center justify-center rounded-[7px] text-ink-2 transition-colors',
        'hover:bg-muted hover:text-ink',
      )}
    >
      {icon}
    </button>
  );
}
