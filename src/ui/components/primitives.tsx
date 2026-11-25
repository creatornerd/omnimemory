import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { cx } from '../format';

/**
 * The OmniMemory mark: two overlapping rings (your AI and your memory), with
 * the shared middle filled in blue — what OmniMemory passes between them.
 */
export function Logo({ size = 20 }: { size?: number }) {
  const stroke = size <= 16 ? 1.9 : size <= 28 ? 1.7 : 1.6;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flex: 'none' }}>
      <rect width="24" height="24" rx="6.5" fill="var(--om-logo-bg)" />
      <path d="M12 7.62A5.2 5.2 0 0 1 12 16.38A5.2 5.2 0 0 1 12 7.62Z" fill="var(--om-brand)" />
      <circle cx="9.2" cy="12" r="5.2" stroke="var(--om-logo-ring)" strokeWidth={stroke} />
      <circle cx="14.8" cy="12" r="5.2" stroke="var(--om-logo-ring)" strokeWidth={stroke} />
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
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap',
        'transition-colors duration-100 disabled:opacity-45',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-[34px] px-3.5 text-[13px]',
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
        'inline-flex size-[30px] shrink-0 items-center justify-center rounded-[7px] transition-colors duration-100',
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
        'h-[30px] rounded-lg border border-line-strong bg-surface pr-6 pl-2.5 text-xs text-ink',
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
        'inline-flex h-5 shrink-0 items-center rounded-[5px] px-[7px] text-[11.5px] font-medium',
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
        'flex gap-2 rounded-[10px] px-3 py-2.5 text-[12.5px] leading-relaxed',
        tone === 'warn' && 'bg-warn-soft text-warn',
        tone === 'danger' && 'bg-danger-soft text-danger',
        tone === 'info' && 'bg-brand-soft text-ink-2',
      )}
    >
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
