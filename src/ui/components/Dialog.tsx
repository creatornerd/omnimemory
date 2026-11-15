import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button, IconButton } from './primitives';
import { cx } from '../format';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg';
}

const WIDTHS = { sm: 'w-[380px]', md: 'w-[480px]', lg: 'w-[640px]' };

/**
 * Modal built on the native <dialog>: focus is trapped, Escape closes, and
 * the rest of the page is inert while it is open.
 */
export function Dialog({ open, onClose, title, children, footer, width = 'md' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose(); // click on the backdrop
      }}
      aria-label={title}
      className={cx(
        'animate-rise m-auto max-h-[calc(100vh-32px)] max-w-[calc(100vw-24px)] rounded-xl border border-line',
        'bg-surface p-0 text-ink shadow-pop',
        WIDTHS[width],
      )}
    >
      <div className="flex max-h-[calc(100vh-34px)] flex-col">
        <header className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={15} />
          </IconButton>
        </header>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
            {footer}
          </footer>
        )}
      </div>
    </dialog>
  );
}

interface ConfirmProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, children, confirmLabel, danger, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      width="sm"
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-2 text-[13px] leading-relaxed text-ink-2">{children}</div>
    </Dialog>
  );
}
