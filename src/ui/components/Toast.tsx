import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

interface ToastState {
  id: number;
  message: string;
  action?: ToastAction;
}

type ShowToast = (message: string, action?: ToastAction) => void;

const ToastContext = createContext<ShowToast>(() => {});

export function useToast(): ShowToast {
  return useContext(ToastContext);
}

/** One toast at a time, bottom-centre, with an optional action such as Undo. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback<ShowToast>((message, action) => {
    clearTimeout(timer.current);
    const id = Date.now();
    setToast({ id, message, action });
    timer.current = setTimeout(
      () => setToast((current) => (current?.id === id ? null : current)),
      action ? 7000 : 3500,
    );
  }, []);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-3 z-50 flex justify-center px-3"
      >
        {toast && (
          <div
            key={toast.id}
            className="animate-rise pointer-events-auto flex max-w-full items-center gap-3 rounded-lg bg-ink py-2 pr-2 pl-3 text-xs text-canvas shadow-pop"
          >
            <span className="min-w-0 truncate">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="shrink-0 rounded px-2 py-1 font-semibold underline-offset-2 hover:underline"
                onClick={() => {
                  void toast.action?.run();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
