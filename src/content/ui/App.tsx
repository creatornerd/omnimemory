import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { CONTEXT_FOOTER, CONTEXT_HEADER } from '../../core/context';
import { BLOCK_END, BLOCK_START } from '../../core/sync';
import { MAX_CONTENT_LENGTH } from '../../core/types';
import type { SiteAdapter } from '../adapters';
import { Mark } from './Mark';
import { Panel } from './Panel';

/** The launcher: a small pill labelled "Memory" above the message box. */
const PILL = 28;
const PILL_W = 88;
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
  const maxLeft = window.innerWidth - PILL_W - GAP;
  const maxTop = window.innerHeight - PILL - GAP;
  if (!composer) return { left: maxLeft - 8, top: maxTop - 8, docked: true };

  const rect = adapter.findAnchor(composer).getBoundingClientRect();
  // Just outside the composer's top-right corner (or bottom-right, where the
  // site keeps buttons of its own above the box), so nothing of the site's is covered.
  const below = rect.bottom + 6;
  let top = rect.top - PILL - 6;
  if (adapter.launcher === 'below' && below + PILL <= window.innerHeight - 2) top = below;
  else if (top < GAP) top = below;
  return {
    left: Math.round(Math.min(Math.max(rect.right - PILL_W - 2, GAP), maxLeft)),
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

/** OmniMemory's own text (an inserted context, a synced block) is never offered back for saving. */
function isOurText(text: string): boolean {
  return [CONTEXT_HEADER, CONTEXT_FOOTER, BLOCK_START, BLOCK_END, '[Context about me', '[OmniMemory'].some((marker) =>
    text.includes(marker),
  );
}

function pageSelection(): string {
  const text = (window.getSelection()?.toString() ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CONTENT_LENGTH);
  return isOurText(text) ? '' : text;
}

/** Is this text still somewhere on the page (or in the message box)? */
function stillOnPage(text: string, adapter: SiteAdapter): boolean {
  const probe = text.slice(0, 80);
  const flat = (value: string) => value.replace(/\s+/g, ' ');
  return flat(adapter.readDraft()).includes(probe) || flat(document.body?.innerText ?? '').includes(probe);
}

export function App({ adapter }: { adapter: SiteAdapter }) {
  const placement = usePlacement(adapter);
  const theme = useHostTheme();
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState('');
  const [flash, setFlash] = useState('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);

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

  // While the panel is open, keep the "save selection" offer current. Clicking
  // into the panel clears the page's selection, so an empty selection only
  // withdraws the offer once that text is gone from the page.
  useEffect(() => {
    if (!open) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onSelection = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const text = pageSelection();
        if (text) setSelection(text);
        else setSelection((current) => (current && !stillOnPage(current, adapter) ? '' : current));
      }, 300);
    };
    document.addEventListener('selectionchange', onSelection);
    document.addEventListener('input', onSelection, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('selectionchange', onSelection);
      document.removeEventListener('input', onSelection, true);
    };
  }, [open, adapter]);

  // A click anywhere outside OmniMemory closes the panel.
  useEffect(() => {
    if (!open) return;
    const host = (rootRef.current?.getRootNode() as ShadowRoot | null)?.host;
    const onPointer = (event: PointerEvent) => {
      if (host && !event.composedPath().includes(host)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer, true);
    return () => document.removeEventListener('pointerdown', onPointer, true);
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
    flashTimer.current = setTimeout(() => setFlash(''), 2800);
  }, []);

  // Open upwards from the launcher when there is room, otherwise downwards.
  const spaceAbove = placement.top - GAP * 2;
  const spaceBelow = window.innerHeight - placement.top - PILL - GAP * 2;
  const above = spaceAbove >= 300 || spaceAbove >= spaceBelow;
  const right = Math.max(GAP, window.innerWidth - placement.left - PILL_W);
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
    <div className="om-root" data-theme={theme} ref={rootRef}>
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
        <Mark size={16} />
        <span>Memory</span>
      </button>

      {flash && !open && (
        <div
          className="om-flash"
          role="status"
          // Beside the button, on the same line, so it doesn't cover the message box.
          style={{
            right: Math.min(window.innerWidth - 160, window.innerWidth - placement.left + 6),
            top: placement.top,
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
