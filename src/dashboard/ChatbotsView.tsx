import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, Check, ChevronRight, Inbox, Link2, RefreshCw } from 'lucide-react';
import {
  SITE_IDS,
  BLOCK_LIMITS,
  SYNC_MODES,
  SYNC_TARGETS,
  pendingChanges,
  renderBlock,
  syncBlocked,
  type RemoteEntry,
  type SiteId,
  type SiteSyncState,
  type SyncLink,
} from '../core';
import { ActivityFeed, Approvals } from './SyncPanels';
import { requestSync } from './sync-actions';
import { onChange } from '../shared/change-bus';
import { getSyncService } from '../shared/platform';
import { SITES, TRADEMARK_NOTICE } from '../shared/sites';
import { useFound } from '../ui/hooks/useFound';
import { Badge, Button, Notice, Toggle } from '../ui/components/primitives';
import { useToast } from '../ui/components/Toast';
import { plural, timeAgo } from '../ui/format';
import type { Store } from '../ui/hooks/useStore';
import { Help } from './help';

export type States = Partial<Record<SiteId, SiteSyncState>>;

export function useSyncStates(): States {
  const [states, setStates] = useState<States>({});
  const load = useCallback(async () => {
    const sync = getSyncService();
    const entries = await Promise.all(SITE_IDS.map(async (site) => [site, await sync.state(site)] as const));
    setStates(Object.fromEntries(entries));
  }, []);
  useEffect(() => {
    void load();
    const stop = onChange(() => void load());
    // Keep "x minutes ago" fresh.
    const tick = setInterval(() => void load(), 30_000);
    return () => {
      stop();
      clearInterval(tick);
    };
  }, [load]);
  return states;
}

export function StatusLine({ site, state, store }: { site: SiteId; state: SiteSyncState | undefined; store: Store }) {
  const { settings, library } = store;
  const blocked = syncBlocked(settings, site);
  const pending = state ? pendingChanges(site, library, settings, state) : 0;

  if (blocked === 'not-supported') return <Badge>Not available yet</Badge>;
  if (blocked === 'off') return <Badge>Off</Badge>;
  if (blocked === 'paused') return <Badge tone="warn">Paused — sharing is off</Badge>;
  if (state && state.held.length > 0) return <Badge tone="warn">Waiting for your OK</Badge>;
  if (state?.lastError) return <Badge tone="danger">Needs attention</Badge>;
  if (pending > 0) return <Badge tone="warn">{plural(pending, 'change', 'changes')} waiting</Badge>;
  if (state?.lastSyncAt) return <Badge tone="ok">In sync · {timeAgo(state.lastSyncAt)}</Badge>;
  return <Badge tone="warn">Not synced yet</Badge>;
}

function EntryList({ site, entries, links, store }: { site: SiteId; entries: RemoteEntry[]; links: SyncLink[]; store: Store }) {
  const libraryIds = useMemo(() => new Set(store.library.map((memory) => memory.id)), [store.library]);
  const ownedBy = useMemo(() => new Map(links.map((link) => [link.memoryId, link.owned])), [links]);
  const groups = useMemo(() => {
    const map = new Map<string, RemoteEntry[]>();
    for (const entry of entries) map.set(entry.group, [...(map.get(entry.group) ?? []), entry]);
    return [...map.entries()];
  }, [entries]);

  if (entries.length === 0) {
    return <p className="py-3 text-xs text-ink-3">{SITES[site].label} doesn’t have anything saved yet.</p>;
  }

  return (
    <div className="space-y-4">
      {groups.map(([group, items]) => (
        <div key={group}>
          <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{group}</h4>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {items.map((entry) => {
              const fromOmni = entry.memoryId !== undefined && libraryIds.has(entry.memoryId);
              return (
                <li key={entry.id} className="flex items-start gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    {entry.title && <p className="text-xs font-medium">{entry.title}</p>}
                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink-2">{entry.text}</p>
                  </div>
                  {fromOmni &&
                    (ownedBy.get(entry.memoryId as string) === false ? (
                      <span title={`${SITES[site].label} had this first. OmniMemory keeps it up to date and asks before removing it.`}>
                        <Badge>
                          <Link2 size={11} className="mr-0.5" /> Linked
                        </Badge>
                      </span>
                    ) : (
                      <span title="OmniMemory added this">
                        <Badge tone="ok">
                          <Check size={11} className="mr-0.5" /> Added by OmniMemory
                        </Badge>
                      </span>
                    ))}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Said plainly, so nobody expects OmniMemory to edit a chatbot's own AI-written memory. */
const WRITES: Record<SiteId, string> = {
  chatgpt: 'Your shared memories, as a marked block in Custom instructions → “More about you”. Your own text there is never changed.',
  claude: 'Your shared memories, as a marked block in Settings → Your Claude → Instructions. Your own text there is never changed.',
  gemini: 'Each shared memory as one of Gemini’s Instructions. Entries Gemini already had are only linked or removed with your OK.',
};
const READS: Record<SiteId, string> = {
  chatgpt: 'ChatGPT’s own Memory, which ChatGPT writes from your chats. New things in it are offered on Review; OmniMemory can’t edit it.',
  claude: 'Claude’s own Memory, which Claude writes from your chats. New things in it are offered on Review; OmniMemory can’t edit it.',
  gemini: 'Instructions you added in Gemini yourself. New ones are offered on Review.',
};

const SITE_NOTES: Record<SiteId, string> = {
  chatgpt:
    'ChatGPT reads custom instructions when a new chat starts. Its own Memory summary is written by ChatGPT from your chats; it’s shown here, but OmniMemory only reads it.',
  claude:
    'OmniMemory adds a marked block after anything you wrote yourself. Claude’s own Memory is written by Claude from your chats; it’s shown here, but OmniMemory only reads it.',
  gemini: 'Each memory becomes one of Gemini’s instructions. Entries Gemini had before stay yours.',
};

/** A section that starts folded, to keep the page short. */
function Fold({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 text-left text-[13px] font-medium text-ink hover:text-ink-2"
      >
        <ChevronRight size={14} className={open ? 'rotate-90 transition-transform' : 'transition-transform'} />
        {title}
        {hint && <span className="font-normal text-ink-3">· {hint}</span>}
      </button>
      {open && <div className="mt-2.5">{children}</div>}
    </div>
  );
}

/** How much of the chatbot's field OmniMemory's block uses (block mode only). */
function SpaceUsed({ site, state }: { site: SiteId; state: SiteSyncState | undefined }) {
  const limits = SYNC_MODES[site] === 'block' ? BLOCK_LIMITS[site] : undefined;
  if (!limits || !state?.lastSyncAt) return null;
  const used = renderBlock(state.links.map((link) => link.pushedText)).length;
  const share = Math.min(100, Math.round((used / limits.block) * 100));
  return (
    <div className="min-w-[220px] flex-1">
      <div className="flex justify-between text-xs text-ink-3">
        <span className="flex items-center gap-1">
          Space used <Help id="chatbots.space" />
        </span>
        <span className="tabular-nums">
          {used.toLocaleString()} of {limits.block.toLocaleString()} characters
        </span>
      </div>
      <div className="mt-2 h-[5px] rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${share}%`, background: SITES[site].color }} />
      </div>
    </div>
  );
}

function SiteCard({ site, state, store }: { site: SiteId; state: SiteSyncState | undefined; store: Store }) {
  const { service, settings } = store;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const info = SITES[site];
  const supported = SYNC_MODES[site] !== null;
  const blocked = syncBlocked(settings, site);

  async function syncNow() {
    setBusy(true);
    try {
      toast(await requestSync(site));
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setTimeout(() => setBusy(false), 1500);
    }
  }

  async function setSync(on: boolean) {
    await service.updateSettings({ siteSync: { [site]: on } });
    if (!on) return;
    try {
      await requestSync(site);
      toast(
        state?.approvedAt
          ? `Syncing with ${info.label}…`
          : `Checking ${info.label}. You’ll see exactly what would change before anything is written.`,
      );
    } catch (error) {
      toast((error as Error).message);
    }
  }

  return (
    <section className="rounded-[14px] border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-2.5 px-4 py-3.5">
        <span className="size-2.5 rounded-full" style={{ background: info.color }} aria-hidden="true" />
        <h2 className="text-[15px] font-semibold">{info.label}</h2>
        <StatusLine site={site} state={state} store={store} />
        <div className="ml-auto flex items-center gap-3">
          {supported && (
            <Button size="sm" icon={<RefreshCw size={13} className={busy ? 'animate-spin' : ''} />} disabled={busy || blocked !== null} onClick={() => void syncNow()}>
              Sync now
            </Button>
          )}
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
            Keep in sync
            <Toggle
              label={`Keep ${info.label}’s memory in sync`}
              disabled={!supported}
              checked={supported && settings.siteSync[site]}
              onChange={(on) => void setSync(on)}
            />
          </label>
        </div>
      </header>

      <div className="border-t border-line px-4 pt-3.5 pb-4">
        {!supported ? (
          <p className="text-xs leading-relaxed text-ink-3">
            Syncing with {info.label}’s own memory isn’t available yet. You can still use the OmniMemory button on{' '}
            {info.hosts[0]} to add memories to a message.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-6 text-[13px]">
              <div>
                <div className="flex items-center gap-1 text-xs text-ink-3">
                  Writes to <Help id="chatbots.writes" />
                </div>
                <div className="mt-0.5 font-medium">{SYNC_TARGETS[site]}</div>
              </div>
              <SpaceUsed site={site} state={state} />
            </div>
            <p className="mt-3 max-w-[640px] text-[12.5px] leading-relaxed text-ink-3">
              {WRITES[site]} It only reads {READS[site]}
            </p>
            {state && blocked === null && (
              <Approvals
                site={site}
                held={state.held}
                onAnswered={() => void requestSync(site).catch(() => {})}
                onTurnOff={() => void setSync(false)}
              />
            )}
            {state?.lastError && (
              <div className="mt-3">
                <Notice tone="danger">{state.lastError}</Notice>
              </div>
            )}
            {state?.notes.map((note) => (
              <div key={note} className="mt-3">
                <Notice tone="warn">{note}</Notice>
              </div>
            ))}
            {state?.snapshot ? (
              <Fold
                title={`What ${info.label} remembers (${state.snapshot.entries.length})`}
                hint={`checked ${timeAgo(state.snapshot.fetchedAt)}`}
              >
                {SITE_NOTES[site] && <p className="mb-2.5 text-xs leading-relaxed text-ink-3">{SITE_NOTES[site]}</p>}
                <EntryList site={site} entries={state.snapshot.entries} links={state.links} store={store} />
              </Fold>
            ) : (
              blocked === null && (
                <p className="mt-3 text-[12.5px] text-ink-3">Not checked yet. Open {info.hosts[0]} while signed in, or press Sync now.</p>
              )
            )}
            {state && state.activity.length > 0 && (
              <Fold title={`Recent activity (${state.activity.length})`}>
                <p className="mb-2 flex items-center gap-1 text-xs text-ink-3">
                  What sync changed, newest first <Help id="chatbots.activity" />
                </p>
                <ActivityFeed site={site} activity={state.activity} />
              </Fold>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export function ChatbotsView({ store }: { store: Store }) {
  const states = useSyncStates();
  const { found } = useFound();
  const { settings } = store;

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[860px] space-y-4 px-10 pb-16 max-md:px-5">
        <header className="pt-8">
          <h1 className="flex items-center gap-1.5 text-[22px] font-semibold tracking-[-0.02em]">
            Chatbots <Help id="chatbots.page" />
          </h1>
          <p className="mt-1.5 max-w-[620px] text-[13.5px] leading-relaxed text-ink-2">
            Keep each chatbot’s own memory in step with yours. Nothing is written without your OK, and every change can
            be undone.
          </p>
        </header>

        {found.length > 0 && (
          <a
            href="#/review"
            className="flex items-center gap-3 rounded-xl border border-line-strong bg-surface px-4 py-3.5 text-[13.5px] hover:bg-subtle hover:no-underline"
          >
            <Inbox size={16} className="shrink-0 text-ink-2" />
            <span className="min-w-0 flex-1">
              <strong className="font-semibold">{plural(found.length, 'thing', 'things')} to review.</strong>{' '}
              <span className="text-ink-2">Your chatbots remember things OmniMemory doesn’t have yet.</span>
            </span>
            <ArrowRight size={15} />
          </a>
        )}

        {settings.sharingPaused && (
          <Notice tone="warn">Sharing is paused, so nothing is synced until you turn it back on.</Notice>
        )}

        {(SITE_IDS as readonly SiteId[]).map((site) => (
          <SiteCard key={site} site={site} state={states[site]} store={store} />
        ))}

        <p className="text-[11.5px] leading-relaxed text-ink-3">{TRADEMARK_NOTICE}</p>
      </div>
    </div>
  );
}
