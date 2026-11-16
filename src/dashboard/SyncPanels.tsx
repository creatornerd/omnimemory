import { useState } from 'react';
import { CheckCheck, Link2, Minus, Pencil, Plus, ShieldCheck, Undo2, UserPen, UserX, Download } from 'lucide-react';
import type { ActivityEntry, ActivityKind, HeldChange, SiteId } from '../core';
import { getSyncService } from '../shared/platform';
import { SITES } from '../shared/sites';
import { Badge, Button } from '../ui/components/primitives';
import { useToast } from '../ui/components/Toast';
import { cx, plural, timeAgo } from '../ui/format';

const PREVIEW_ICON = { add: Plus, update: Pencil, remove: Minus } as const;
const PREVIEW_WORD = { add: 'Add', update: 'Update', remove: 'Remove' } as const;

function Quote({ children }: { children: string }) {
  return (
    <p className="mt-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] leading-relaxed whitespace-pre-wrap text-ink">
      {children}
    </p>
  );
}

/**
 * Changes OmniMemory won't make on a chatbot without asking: its first write
 * there, taking over an entry the chatbot already had, and removing an entry
 * it didn't add itself.
 */
export function Approvals({
  site,
  held,
  onAnswered,
  onTurnOff,
}: {
  site: SiteId;
  held: HeldChange[];
  /** Run a sync so the answer takes effect straight away. */
  onAnswered: () => void;
  onTurnOff: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const label = SITES[site].label;
  if (held.length === 0) return null;

  async function answer(key: string, yes: boolean) {
    setBusy(true);
    try {
      await getSyncService().decide(site, key, yes);
      onAnswered();
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function approveAll() {
    setBusy(true);
    try {
      await getSyncService().approveAll(site);
      toast(`Approved ${held.length} changes for ${label}. Syncing…`);
      onAnswered();
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-warn/40 bg-warn-soft/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck size={14} className="text-warn" />
        <h3 className="text-[13px] font-semibold">Waiting for your OK</h3>
        <span className="text-xs text-ink-3">{held.length}</span>
        {held.length > 1 && (
          <Button
            size="sm"
            variant="primary"
            className="ml-auto"
            icon={<CheckCheck size={13} />}
            disabled={busy}
            onClick={() => void approveAll()}
          >
            Approve all {held.length} for {label}
          </Button>
        )}
      </div>
      {held.length > 1 && (
        <p className="mt-1 text-xs leading-relaxed text-ink-3">
          Look through them below if you’d like to decide one by one.
        </p>
      )}
      <ul className="mt-2 space-y-3">
        {held.map((change) => (
          <li key={change.key} className="rounded-md bg-surface/70 p-2.5">
            {change.kind === 'first-write' && (
              <>
                <p className="text-[13px] font-medium">Check before OmniMemory writes to {label} for the first time</p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
                  Nothing has been changed on {label} yet. This is what turning on sync would do:
                </p>
                <ul className="mt-2 divide-y divide-line rounded-md border border-line bg-surface">
                  {(change.preview ?? []).map((row, index) => {
                    const Icon = PREVIEW_ICON[row.action];
                    return (
                      <li key={index} className="flex items-start gap-2 px-2.5 py-1.5 text-[13px]">
                        <Icon
                          size={13}
                          className={cx('mt-1 shrink-0', row.action === 'remove' ? 'text-danger' : 'text-ok')}
                          aria-label={PREVIEW_WORD[row.action]}
                        />
                        <span className="leading-relaxed">{row.text}</span>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" disabled={busy} onClick={() => void answer(change.key, true)}>
                    Looks good, start syncing
                  </Button>
                  <Button size="sm" disabled={busy} onClick={onTurnOff}>
                    Turn off sync
                  </Button>
                </div>
              </>
            )}

            {change.kind === 'adopt' && (
              <>
                <p className="text-[13px] font-medium">{label} already has this</p>
                <Quote>{change.remoteText ?? ''}</Quote>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
                  It says the same as your memory, so OmniMemory didn’t add a second copy. Link them and OmniMemory
                  keeps {label}’s entry up to date when you edit the memory. It will still ask before removing it.
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" disabled={busy} onClick={() => void answer(change.key, true)}>
                    Link them
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => void answer(change.key, false)}>
                    Leave {label}’s alone
                  </Button>
                </div>
              </>
            )}

            {change.kind === 'delete' && (
              <>
                <p className="text-[13px] font-medium">Remove this from {label}?</p>
                <Quote>{change.remoteText ?? ''}</Quote>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
                  The memory it’s linked to was deleted or is no longer shared with {label}
                  {change.legacy
                    ? ', but it was linked by an earlier version of OmniMemory that didn’t record who added it.'
                    : `, but ${label} had this before it was linked to OmniMemory.`}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Button size="sm" variant="dangerOutline" disabled={busy} onClick={() => void answer(change.key, true)}>
                    Remove from {label}
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => void answer(change.key, false)}>
                    Keep it on {label}
                  </Button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const ACTIVITY: Record<ActivityKind, { icon: typeof Plus; text: (label: string) => string; undo?: string }> = {
  added: { icon: Plus, text: (l) => `Added to ${l}`, undo: 'Take off' },
  updated: { icon: Pencil, text: (l) => `Updated on ${l}` },
  removed: { icon: Minus, text: (l) => `Removed from ${l}`, undo: 'Put back' },
  linked: { icon: Link2, text: (l) => `Linked ${l}’s own entry`, undo: 'Unlink' },
  'edited-there': { icon: UserPen, text: (l) => `Edited on ${l}, memory updated`, undo: 'Change back' },
  'removed-there': { icon: UserX, text: (l) => `Removed on ${l}, no longer shared with it`, undo: 'Share again' },
  imported: { icon: Download, text: () => 'Typed into OmniMemory’s block, saved as a memory', undo: 'Delete memory' },
};

const SHOWN = 6;

/** What syncing changed on this chatbot, newest first, with undo. */
export function ActivityFeed({ site, activity }: { site: SiteId; activity: ActivityEntry[] }) {
  const toast = useToast();
  const [all, setAll] = useState(false);
  const label = SITES[site].label;
  if (activity.length === 0) return null;
  const newest = [...activity].reverse();
  const rows = all ? newest : newest.slice(0, SHOWN);

  async function undo(entry: ActivityEntry) {
    try {
      toast(await getSyncService().undo(site, entry.id));
    } catch (error) {
      toast((error as Error).message);
    }
  }

  return (
    <div className="mt-5">
      <h3 className="text-[13px] font-semibold">Recent activity</h3>
      <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
        {rows.map((entry) => {
          const info = ACTIVITY[entry.kind];
          const Icon = info.icon;
          return (
            <li key={entry.id} className={cx('flex items-start gap-2.5 px-3 py-2', entry.undoneAt && 'opacity-55')}>
              <Icon size={13} className="mt-1 shrink-0 text-ink-3" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-ink-3">
                  {info.text(label)} · {timeAgo(entry.at)}
                </p>
                <p className="truncate text-[13px] text-ink-2" title={entry.text}>
                  {entry.text}
                </p>
              </div>
              {entry.undoneAt ? (
                <Badge>Undone</Badge>
              ) : (
                info.undo &&
                entry.memoryId && (
                  <Button size="sm" variant="ghost" icon={<Undo2 size={12} />} onClick={() => void undo(entry)}>
                    {info.undo}
                  </Button>
                )
              )}
            </li>
          );
        })}
      </ul>
      {newest.length > SHOWN && (
        <button type="button" className="mt-1.5 text-xs text-ink-2 hover:text-ink" onClick={() => setAll(!all)}>
          {all ? 'Show less' : `Show all ${plural(newest.length, 'change', 'changes')}`}
        </button>
      )}
    </div>
  );
}
