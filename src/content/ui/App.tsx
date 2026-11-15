import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { MAX_CONTENT_LENGTH } from '../../core/types';
import type { SiteAdapter } from '../adapters';
import { Mark } from './Mark';
import { Panel } from './Panel';

const PILL = 30;
const GAP = 8;
const PANEL_WIDTH = 368;
const PANEL_MAX_HEIGHT = 520;

interface Placement {
  left: number;
  top: number;
  /** True when no composer was found and the launcher sits in the corner. */
  docked: boolean;
}

function computePlacement(adapter: SiteAdapter): Placement {
  const composer = adapter.findComposer();
  const maxLeft = window.innerWidth - PILL - GAP;
  const maxTop = window.innerHeight - PILL - GAP;
  if (!composer) return { left: maxLeft - 8, top: maxTop - 8, docked: true };

  const rect = adapter.findAnchor(composer).getBoundingClientRect();
  // Just outside the composer's top-right corner, so nothing of the site's is covered.
  let top = rect.top - PILL - 6;
  if (top < GAP) top = rect.bottom + 6;
  return {
    left: Math.round(Math.min(Math.max(rect.right - PILL - 2, GAP), maxLeft)),
    top: Math.round(Math.min(Math.max(top, GAP), maxTop)),
    docked: false,
  };
}

/** Follow the composer around as the site re-lays itself out. */
function usePlacement(adapter: SiteAdapter): Placement {
  const [placement, setPlacement] = useState(() => computePlacement(adapter));
  useEffect(() => {
    const update = () => {
      const next = computePlacement(adapter);
      setPlacement((current) =>
        current.left === next.left && current.top === next.top && current.docked === next.docked ? current : next,
      );
    };
    const timer = setInterval(update, 350);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, { capture: true, passive: true });
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, { capture: true });
    };
  }, [adapter]);
  return placement;
}

/** Match the host page: read its real background rather than guess from the OS. */
function detectTheme(): 'light' | 'dark' {
  for (const el of [document.body, document.documentElement]) {
    if (!el) continue;
    const match = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
    if (!match || match.length < 3) continue;
    const [r, g, b, a = '1'] = match;
    if (Number(a) === 0) continue;
    const luminance = (0.2126 * Number(r) + 0.7152 * Number(g) + 0.0722 * Number(b)) / 255;
    return luminance < 0.45 ? 'dark' : 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function useHostTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState(detectTheme);
  useEffect(() => {
    const timer = setInterval(() => setTheme(detectTheme()), 1500);
    return () => clearInterval(timer);
  }, []);
  return theme;
}

function pageSelection(): string {
  return (window.getSelection()?.toString() ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CONTENT_LENGTH);
}

export function App({ adapter }: { adapter: SiteAdapter }) {
  const placement = usePlacement(adapter);
  const theme = useHostTheme();
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState('');
  const [flash, setFlash] = useState('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const close = useCallback(() => {
    setOpen(false);
    adapter.findComposer()?.focus();
  }, [adapter]);

  const toggle = useCallback(() => {
    setOpen((current) => {
      // Only text the user has highlighted right now is offered for saving.
      if (!current) setSelection(pageSelection());
      return !current;
    });
  }, []);

  // While the panel is open, keep the "save selection" offer current.
  useEffect(() => {
    if (!open) return;
    const onSelection = () => {
      const text = pageSelection();
      if (text) setSelection(text);
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, [open]);

  // Alt+Shift+M toggles the panel from anywhere on the page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && event.shiftKey && event.code === 'KeyM') {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [toggle]);

  const done = useCallback((message: string) => {
    setOpen(false);
    setFlash(message);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(''), 4000);
  }, []);

  // Open upwards from the launcher when there is room, otherwise downwards.
  const spaceAbove = placement.top - GAP * 2;
  const spaceBelow = window.innerHeight - placement.top - PILL - GAP * 2;
  const above = spaceAbove >= 300 || spaceAbove >= spaceBelow;
  const right = Math.max(GAP, window.innerWidth - placement.left - PILL);
  const panelStyle: CSSProperties = {
    right: Math.min(right, Math.max(GAP, window.innerWidth - PANEL_WIDTH - GAP)),
    maxHeight: Math.max(220, Math.min(PANEL_MAX_HEIGHT, above ? spaceAbove : spaceBelow)),
    ...(above
      ? { bottom: window.innerHeight - placement.top + GAP }
      : { top: placement.top + PILL + GAP }),
  };

  // Stay out of the way on sign-in pages and the like.
  if (!adapter.isActive()) return null;

  return (
    <div className="om-root" data-theme={theme}>
      <button
        className="om-pill"
        style={{ left: placement.left, top: placement.top }}
        aria-label="OmniMemory"
        aria-expanded={open}
        title="OmniMemory — add context from your memories (Alt+Shift+M)"
        // Keep the page's text selection and composer focus intact on click.
        onPointerDown={(event) => event.preventDefault()}
        onMouseDown={(event) => event.preventDefault()}
        onClick={toggle}
      >
        <Mark size={18} />
      </button>

      {flash && !open && (
        <div
          className="om-flash"
          role="status"
          style={{
            right: Math.max(GAP, window.innerWidth - placement.left - PILL),
            ...(above
              ? { bottom: window.innerHeight - placement.top + GAP }
              : { top: placement.top + PILL + GAP }),
          }}
        >
          {flash}
        </div>
      )}

      {open && (
        <Panel
          adapter={adapter}
          style={panelStyle}
          selection={selection}
          onClearSelection={() => setSelection('')}
          onClose={close}
          onDone={done}
        />
      )}
    </div>
  );
}
