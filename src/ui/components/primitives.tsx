import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { cx } from '../format';

export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="var(--om-accent)" />
      <circle cx="11" cy="13" r="5" stroke="var(--om-accent-fg)" strokeWidth="2.2" />
      <circle cx="17.4" cy="6.6" r="2" fill="var(--om-accent-fg)" />
    </svg>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerOutline';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-subtle',
  ghost: 'text-ink-2 hover:bg-subtle hover:text-ink',
  danger: 'bg-danger-solid text-white hover:opacity-90',
  dangerOutline: 'border border-line-strong bg-surface text-danger hover:bg-danger-soft',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap',
        'transition-colors duration-100 disabled:opacity-45',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: used for both the accessible name and the tooltip. */
  label: string;
  tone?: 'default' | 'danger';
  active?: boolean;
}

export function IconButton({ label, tone = 'default', active, className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors duration-100',
        'disabled:opacity-40',
        active ? 'bg-muted text-ink' : 'text-ink-3 hover:bg-muted',
        tone === 'danger' ? 'hover:text-danger' : 'hover:text-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

/** Accessible on/off switch. */
export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors duration-150',
        'disabled:opacity-45',
        checked ? 'bg-accent' : 'bg-line-strong',
      )}
    >
      <span
        className={cx(
          'absolute left-0.5 size-3.5 rounded-full bg-surface shadow-sm transition-transform duration-150',
          checked ? 'translate-x-3.5 bg-accent-fg' : '',
        )}
      />
    </button>
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        'h-7 rounded-md border border-line-strong bg-surface pr-6 pl-2 text-xs text-ink',
        'transition-colors hover:border-ink-3',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

type BadgeTone = 'neutral' | 'warn' | 'danger' | 'ok';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-muted text-ink-2',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  ok: 'bg-ok-soft text-ok',
};

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex h-[18px] shrink-0 items-center rounded px-1.5 text-[11px] font-medium',
        BADGE_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Inline notice used for warnings inside forms and dialogs. */
export function Notice({
  tone = 'warn',
  icon,
  children,
}: {
  tone?: 'warn' | 'danger' | 'info';
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === 'info' ? 'note' : 'alert'}
      className={cx(
        'flex gap-2 rounded-md px-2.5 py-2 text-xs leading-relaxed',
        tone === 'warn' && 'bg-warn-soft text-warn',
        tone === 'danger' && 'bg-danger-soft text-danger',
        tone === 'info' && 'bg-subtle text-ink-2',
      )}
    >
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
