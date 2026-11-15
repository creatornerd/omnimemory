import { Lock, LockOpen } from 'lucide-react';
import type { SiteId, SitePermissions } from '../../core/types';
import { SITE_LIST } from '../../shared/sites';
import { cx } from '../format';

interface SiteTogglesProps {
  permissions: SitePermissions;
  /** false = "keep private": nothing is shared, per-site choices are kept. */
  enabled: boolean;
  onPermission: (site: SiteId, allowed: boolean) => void;
  onEnabled: (enabled: boolean) => void;
  /** "dots" for dense rows, "labels" where there is room to spell it out. */
  variant?: 'dots' | 'labels';
}

/**
 * Per-memory sharing controls: one toggle per chatbot plus a private switch.
 * Turning sharing off never deletes anything.
 */
export function SiteToggles({ permissions, enabled, onPermission, onEnabled, variant = 'dots' }: SiteTogglesProps) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Sharing">
      {SITE_LIST.map((site) => {
        const allowed = permissions[site.id];
        const live = allowed && enabled;
        const label = !enabled
          ? `${site.label}: off while private`
          : allowed
            ? `Shared with ${site.label} — click to stop`
            : `Not shared with ${site.label} — click to share`;
        return (
          <button
            key={site.id}
            type="button"
            role="switch"
            aria-checked={live}
            aria-label={`Share with ${site.label}`}
            title={label}
            disabled={!enabled}
            onClick={() => onPermission(site.id, !allowed)}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-full border text-[11px] font-medium transition-colors duration-100',
              variant === 'dots' ? 'size-6 justify-center' : 'h-6 px-2',
              live
                ? 'border-line-strong bg-surface text-ink'
                : 'border-transparent bg-transparent text-ink-3 hover:bg-muted',
              !enabled && 'opacity-50 hover:bg-transparent',
            )}
          >
            <span
              className="size-2 rounded-full transition-colors"
              style={{
                background: live ? site.color : 'transparent',
                boxShadow: live ? 'none' : 'inset 0 0 0 1.5px var(--om-ink-3)',
              }}
            />
            {variant === 'labels' && site.label}
          </button>
        );
      })}
      <button
        type="button"
        role="switch"
        aria-checked={!enabled}
        aria-label="Keep private"
        title={enabled ? 'Keep private — stop sharing with every chatbot' : 'Private — click to share again'}
        onClick={() => onEnabled(!enabled)}
        className={cx(
          'ml-0.5 inline-flex items-center gap-1 rounded-full text-[11px] font-medium transition-colors duration-100',
          variant === 'dots' ? 'size-6 justify-center' : 'h-6 px-2',
          enabled ? 'text-ink-3 hover:bg-muted hover:text-ink' : 'bg-ink text-canvas',
        )}
      >
        {enabled ? <LockOpen size={12} /> : <Lock size={12} />}
        {variant === 'labels' && 'Private'}
      </button>
    </div>
  );
}
