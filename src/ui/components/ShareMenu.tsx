import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Lock, Sparkles } from 'lucide-react';
import type { SiteId, SitePermissions } from '../../core/types';
import { SITE_LIST } from '../../shared/sites';
import { cx } from '../format';
import { HelpTip } from './HelpTip';
import { Toggle } from './primitives';

interface ShareMenuProps {
  permissions: SitePermissions;
  /** false = "keep private": nothing is shared, per-site choices are kept. */
  enabled: boolean;
  onPermission: (site: SiteId, allowed: boolean) => void;
  onEnabled: (enabled: boolean) => void;
  /** Shown only when the AI assistant is on: may the AI read this memory? */
  aiAllowed?: boolean;
  onAiAllowed?: (allowed: boolean) => void;
}

function shareLabel(permissions: SitePermissions, enabled: boolean): string {
  if (!enabled) return 'Private';
  const on = SITE_LIST.filter((site) => permissions[site.id]);
  if (on.length === 0) return 'Not shared';
  if (on.length === SITE_LIST.length) return 'All chatbots';
  return on.map((site) => site.label).join(', ');
}

/**
 * Per-memory sharing as one button: dots show who gets it, and clicking opens
 * a small menu with a switch per chatbot plus "Keep private".
 * Turning sharing off never deletes anything.
 */
export function ShareMenu({ permissions, enabled, onPermission, onEnabled, aiAllowed, onAiAllowed }: ShareMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const shared = enabled && Object.values(permissions).some(Boolean);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Sharing: ${shareLabel(permissions, enabled)}`}
        onClick={() => setOpen(!open)}
        className="flex h-[30px] max-w-[190px] items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-[12.5px] font-medium whitespace-nowrap transition-colors hover:border-line-strong"
      >
        {enabled ? (
          <span className="flex gap-[3px]" aria-hidden="true">
            {SITE_LIST.map((site) => (
              <span
                key={site.id}
                className="size-2 rounded-full border-[1.5px]"
                style={{ borderColor: site.color, background: permissions[site.id] ? site.color : 'transparent' }}
              />
            ))}
          </span>
        ) : (
          <Lock size={12} className="text-ink-2" />
        )}
        <span className="truncate">{shareLabel(permissions, enabled)}</span>
        <ChevronDown size={13} className="shrink-0 text-ink-3" />
      </button>

      {open && (
        <div
          role="group"
          aria-label="Share this memory with"
          className="animate-rise absolute top-9 right-0 z-30 w-64 rounded-xl border border-line bg-surface shadow-pop"
        >
          <div className="flex items-center gap-1 px-3.5 pt-3 pb-1 text-xs font-semibold text-ink-3">
            Share this memory with
            <HelpTip title="Who can see a memory">
              Each memory has its own switch for every chatbot. “Keep private” hides it from all of them without deleting
              it. If sync is on, sharing a memory with a chatbot also writes it into that chatbot’s memory settings.
            </HelpTip>
          </div>
          {SITE_LIST.map((site) => (
            <label
              key={site.id}
              className={cx('flex items-center gap-[9px] px-3.5 py-2 text-[13px]', !enabled && 'opacity-45')}
            >
              <span className="size-2 rounded-full" style={{ background: site.color }} />
              <span className="flex-1">{site.label}</span>
              <Toggle
                label={`Share with ${site.label}`}
                checked={permissions[site.id]}
                disabled={!enabled}
                onChange={(on) => onPermission(site.id, on)}
              />
            </label>
          ))}
          {onAiAllowed && (
            <label className={cx('flex items-center gap-[9px] px-3.5 py-2 text-[13px]', !shared && 'opacity-45')}>
              <Sparkles size={13} className="text-ink-2" />
              <span className="flex-1">AI assistant may read it</span>
              <Toggle
                label="Let the AI assistant read this memory"
                checked={shared && aiAllowed !== false}
                disabled={!shared}
                onChange={(on) => onAiAllowed(on)}
              />
            </label>
          )}
          <div className="mt-1.5 border-t border-line px-3.5 pt-2.5 pb-3">
            <label className="flex items-center gap-[9px] text-[13px]">
              <Lock size={13} className="text-ink-2" />
              <span className="flex-1">Keep private</span>
              <Toggle label="Keep private" checked={!enabled} onChange={(on) => onEnabled(!on)} />
            </label>
            <p className="mt-1.5 text-[11.5px] leading-snug text-ink-3">Private memories are never added to chats or synced.</p>
          </div>
        </div>
      )}
    </div>
  );
}
