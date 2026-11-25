import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Info, X } from 'lucide-react';
import { cx } from '../format';

const OPEN_EVENT = 'omni:help-open';

/**
 * A small ⓘ beside a part of the page. Click it for a short explanation of
 * what that part does, shown right next to it. Only one is open at a time;
 * Escape or a click elsewhere closes it.
 */
export function HelpTip({
  title,
  children,
  className,
  label,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  /** Screen-reader name; defaults to "What is <title>?". */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  // Placed against the window (position: fixed) so a scrolling sidebar or a
  // card with hidden overflow can't cut it off.
  const [place, setPlace] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0, top: 0 });
  const wrapper = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left - 8, window.innerWidth - width - 12));
    const above = window.innerHeight - rect.bottom < 200 && rect.top > 220;
    setPlace(above ? { left, bottom: window.innerHeight - rect.top + 6 } : { left, top: rect.bottom + 6 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) setOpen(false);
    };
    // It's pinned to where the ⓘ was, so close it once the page moves.
    const onMove = (event: Event) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, onOther);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_EVENT, onOther);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, id]);

  return (
    <span ref={wrapper} className={cx('relative inline-flex align-middle', className)}>
      <button
        ref={button}
        type="button"
        aria-label={label ?? `What is “${title}”?`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={open ? undefined : `What is this?`}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => {
            if (!value) window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
            return !value;
          });
        }}
        className={cx(
          'inline-flex size-[18px] items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-subtle hover:text-ink-2 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none',
          open && 'bg-brand-soft text-brand',
        )}
      >
        <Info size={13} strokeWidth={2.2} />
      </button>
      {open && (
        <span
          id={id}
          role="dialog"
          aria-label={title}
          style={place}
          className="fixed z-50 block w-[280px] max-w-[calc(100vw-24px)] rounded-xl border border-line bg-surface p-3.5 text-left shadow-pop"
        >
          <span className="flex items-start gap-2">
            <span className="flex-1 text-[13px] font-semibold text-ink normal-case tracking-normal">{title}</span>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="-mt-0.5 -mr-1 inline-flex size-6 items-center justify-center rounded-md text-ink-3 hover:bg-subtle hover:text-ink"
            >
              <X size={13} />
            </button>
          </span>
          <span className="mt-1 block text-[12.5px] leading-relaxed font-normal text-ink-2 normal-case tracking-normal">
            {children}
          </span>
        </span>
      )}
    </span>
  );
}
