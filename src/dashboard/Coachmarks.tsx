import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Plus, X } from 'lucide-react';
import { TRASH_RETENTION_DAYS } from '../core';
import type { DashboardView } from '../shared/messages';
import { Button } from '../ui/components/primitives';
import type { Store } from '../ui/hooks/useStore';
import { AiSwitch } from './AiSwitch';

/**
 * A walk around the dashboard after the welcome tour: one popup at a time,
 * pointing at a part of the sidebar while that page is open behind it, saying
 * what it is for. Targets are marked with `data-tour="<id>"`.
 */
interface Mark {
  target: string;
  /** The page to show behind the popup. */
  view?: DashboardView;
  title: string;
  body: ReactNode;
  /** Something to switch on right here, beneath the text. */
  extra?: (store: Store) => ReactNode;
}

const MARKS: Mark[] = [
  {
    target: 'home',
    view: 'home',
    title: 'Home',
    body: 'Your starting point. It shows anything waiting for your OK, how each chatbot’s sync is doing, and the memories you used most recently.',
  },
  {
    target: 'library',
    view: 'library',
    title: 'Memories',
    body: 'Everything you’ve saved. Click a memory to edit it, use its sharing button to choose which chatbots can see it, or mark it private so none of them do.',
  },
  {
    target: 'review',
    view: 'review',
    title: 'Review',
    body: 'When sync reads what a chatbot already remembers, anything you haven’t saved shows up here. Keep what’s useful; nothing is added until you do.',
  },
  {
    target: 'chatbots',
    view: 'chatbots',
    title: 'Chatbots',
    body: 'Turn sync on or off for each chatbot. Changes that need your OK wait here, and the activity list has an Undo for every change sync made.',
  },
  {
    target: 'assistant',
    view: 'assistant',
    title: 'Assistant',
    body: 'Ask in plain words to add, change or tidy up memories. It shows each change first, and nothing happens until you press Apply.',
    extra: (store) => <AiSwitch store={store} />,
  },
  {
    target: 'trash',
    view: 'trash',
    title: 'Recently deleted',
    body: `Deleted memories wait here for ${TRASH_RETENTION_DAYS} days. Restore brings one back exactly as it was.`,
  },
  {
    target: 'settings',
    view: 'settings',
    title: 'Settings',
    body: 'Who new memories are shared with, backups (Export and Import), light or dark mode, and the AI assistant.',
  },
  {
    target: 'sharing',
    title: 'The master switch',
    body: 'Turn this off and no chatbot gets anything, and nothing is synced, until you turn it back on. Your memories stay as they are.',
  },
  {
    target: 'new-memory',
    view: 'home',
    title: 'Save your first memory',
    body: (
      <>
        Add a few things you’d like every chatbot to know. On a chatbot’s page, the <strong>Memory</strong> button by
        the message box adds them to your chat. Look for the <span aria-hidden="true">ⓘ</span> next to any part of the
        dashboard if you need a reminder.
      </>
    ),
  },
];

const POP_WIDTH = 300;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function findTarget(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tour="${id}"]`);
}

export function Coachmarks({
  open,
  store,
  onClose,
  onNavigate,
  onAddMemory,
}: {
  open: boolean;
  store: Store;
  onClose: () => void;
  onNavigate: (view: DashboardView) => void;
  onAddMemory: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [popHeight, setPopHeight] = useState(180);
  const pop = useRef<HTMLDivElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const mark = MARKS[index];
  const last = index === MARKS.length - 1;

  const close = useCallback(() => {
    setIndex(0);
    onClose();
  }, [onClose]);

  // Open the page this step talks about.
  useEffect(() => {
    if (open && mark.view) onNavigate(mark.view);
  }, [open, index]);

  // Follow the target as the page lays itself out.
  useLayoutEffect(() => {
    if (!open) return;
    let scrolled = false;
    const measure = () => {
      const el = findTarget(mark.target);
      if (!el) {
        setBox(null);
        return;
      }
      let rect = el.getBoundingClientRect();
      // The page may only just have opened: bring the target into view once.
      if (!scrolled && (rect.top < 0 || rect.bottom > window.innerHeight)) {
        scrolled = true;
        el.scrollIntoView({ block: 'center' });
        rect = el.getBoundingClientRect();
      }
      setBox((current) =>
        current &&
        current.top === rect.top &&
        current.left === rect.left &&
        current.width === rect.width &&
        current.height === rect.height
          ? current
          : { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      );
      if (pop.current) setPopHeight(pop.current.offsetHeight);
    };
    measure();
    const timer = setInterval(measure, 250);
    window.addEventListener('resize', measure);
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', measure);
    };
  }, [open, mark.target]);

  useEffect(() => {
    if (open) nextButton.current?.focus();
  }, [open, index]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      else if (event.key === 'ArrowRight' && !last) setIndex((value) => value + 1);
      else if (event.key === 'ArrowLeft' && index > 0) setIndex((value) => value - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, last, index]);

  if (!open) return null;

  // Beside the target, on whichever side has room; centred if it can't be found.
  const pad = 6;
  let style: CSSProperties;
  let arrow: 'left' | 'up' | 'down' | null = null;
  if (box) {
    const roomRight = window.innerWidth - (box.left + box.width) - 16;
    if (roomRight >= POP_WIDTH + 16) {
      arrow = 'left';
      const top = box.top + box.height / 2 - 28;
      style = {
        left: box.left + box.width + pad + 12,
        top: Math.max(12, Math.min(top, window.innerHeight - popHeight - 12)),
      };
    } else {
      const left = Math.max(12, Math.min(box.left, window.innerWidth - POP_WIDTH - 12));
      const below = box.top + box.height + pad + 12;
      if (below + popHeight <= window.innerHeight - 12) {
        arrow = 'up';
        style = { left, top: below };
      } else {
        arrow = 'down';
        style = { left, top: Math.max(12, box.top - pad - 12 - popHeight) };
      }
    }
  } else {
    style = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  }

  return (
    <div className="fixed inset-0 z-[60]" role="presentation">
      {/* Dims the page and keeps clicks off it while the walk is on. */}
      <div className="absolute inset-0 bg-black/25" />
      {box && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-xl ring-2 ring-brand transition-all duration-200"
          style={{
            top: box.top - pad,
            left: box.left - pad,
            width: box.width + pad * 2,
            height: box.height + pad * 2,
            boxShadow: '0 0 0 4px color-mix(in srgb, var(--color-brand) 25%, transparent)',
            background: 'color-mix(in srgb, var(--color-surface) 12%, transparent)',
          }}
        />
      )}
      <div
        ref={pop}
        key={index}
        role="dialog"
        aria-modal="true"
        aria-labelledby="om-coach-title"
        className="animate-pop absolute rounded-xl border border-line bg-surface p-4 shadow-pop"
        style={{ ...style, width: POP_WIDTH, maxWidth: 'calc(100vw - 24px)' }}
      >
        {arrow === 'left' && (
          <span
            aria-hidden="true"
            className="absolute top-[22px] -left-[7px] size-3 rotate-45 border-b border-l border-line bg-surface"
          />
        )}
        {arrow === 'down' && (
          <span
            aria-hidden="true"
            className="absolute -bottom-[7px] left-6 size-3 rotate-45 border-r border-b border-line bg-surface"
          />
        )}
        {arrow === 'up' && (
          <span
            aria-hidden="true"
            className="absolute -top-[7px] left-6 size-3 rotate-45 border-t border-l border-line bg-surface"
          />
        )}
        <div className="flex items-start gap-2">
          <p className="flex-1 text-[11px] font-medium text-ink-3 tabular-nums">
            {index + 1} of {MARKS.length}
          </p>
          <button
            type="button"
            aria-label="End the walkthrough"
            onClick={close}
            className="-mt-1 -mr-1.5 inline-flex size-6 items-center justify-center rounded-md text-ink-3 hover:bg-subtle hover:text-ink"
          >
            <X size={13} />
          </button>
        </div>
        <h3 id="om-coach-title" className="mt-0.5 text-[14px] font-semibold">
          {mark.title}
        </h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{mark.body}</p>
        {mark.extra && <div className="mt-3">{mark.extra(store)}</div>}
        <div className="mt-3.5 flex items-center gap-2">
          {index === 0 ? (
            <Button size="sm" variant="ghost" onClick={close}>
              Skip
            </Button>
          ) : (
            <Button size="sm" icon={<ArrowLeft size={12} />} onClick={() => setIndex(index - 1)}>
              Back
            </Button>
          )}
          <span className="flex-1" />
          {last ? (
            <>
              <Button size="sm" variant="ghost" onClick={close}>
                Done
              </Button>
              <Button
                ref={nextButton}
                size="sm"
                variant="primary"
                icon={<Plus size={12} />}
                onClick={() => {
                  close();
                  onAddMemory();
                }}
              >
                Add a memory
              </Button>
            </>
          ) : (
            <Button ref={nextButton} size="sm" variant="primary" onClick={() => setIndex(index + 1)}>
              Next <ArrowRight size={12} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
