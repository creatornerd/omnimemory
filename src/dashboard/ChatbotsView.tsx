import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Link2, RefreshCw } from 'lucide-react';
import {
  SITE_IDS,
  SYNC_MODES,
  SYNC_TARGETS,
  pendingChanges,
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
import { SITES } from '../shared/sites';
import { useFound } from '../ui/hooks/useFound';
import { Badge, Button, Notice, Toggle } from '../ui/components/primitives';
import { useToast } from '../ui/components/Toast';
import { plural, timeAgo } from '../ui/format';
import type { Store } from '../ui/hooks/useStore';

type States = Partial<Record<SiteId, SiteSyncState>>;

function useSyncStates(): States {
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

function StatusLine({ site, state, store }: { site: SiteId; state: SiteSyncState | undefined; store: Store }) {
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
    <section className="rounded-xl border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="size-2.5 rounded-full" style={{ background: info.color }} aria-hidden="true" />
        <h2 className="text-sm font-semibold">{info.label}</h2>
        <StatusLine site={site} state={state} store={store} />
        <div className="ml-auto flex items-center gap-3">
          {supported && (
            <Button size="sm" icon={<RefreshCw size={13} className={busy ? 'animate-spin' : ''} />} disabled={busy || blocked !== null} onClick={() => void syncNow()}>
              Sync now
            </Button>
          )}
          <label className="flex items-center gap-2 text-xs text-ink-2">
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

      <div className="border-t border-line px-4 py-3">
        {!supported ? (
          <p className="text-xs leading-relaxed text-ink-3">
            Syncing with {info.label}’s own memory isn’t available yet. You can still use the OmniMemory button on{' '}
            {info.hosts[0]} to add memories to a message.
          </p>
        ) : (
          <>
            <p className="text-xs leading-relaxed text-ink-3">
              Your memories that are shared with {info.label} are kept in {SYNC_TARGETS[site]}.
              {site === 'chatgpt' &&
                ' ChatGPT reads custom instructions when a new chat starts, so changes show up in new chats, not ones already open. They don’t appear in ChatGPT’s own Memory summary, which ChatGPT writes from your chats; it’s shown here but OmniMemory doesn’t change it.'}
              {site === 'claude' &&
                ' OmniMemory adds a marked block after anything you wrote there yourself, which Claude keeps in mind in every chat. Claude’s own Memory is written by Claude from your chats and changed by asking it in words, so it’s shown here but OmniMemory doesn’t change it.'}
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
            <div className="mt-4 flex items-baseline gap-2">
              <h3 className="text-[13px] font-semibold">What {info.label} remembers</h3>
              {state?.snapshot && <span className="text-[11px] text-ink-3">checked {timeAgo(state.snapshot.fetchedAt)}</span>}
            </div>
            <div className="mt-2">
              {state?.snapshot ? (
                <EntryList site={site} entries={state.snapshot.entries} links={state.links} store={store} />
              ) : (
                <p className="py-3 text-xs text-ink-3">
                  Not checked yet. Open {info.hosts[0]} while signed in, or press Sync now.
                </p>
              )}
            </div>
            {state && <ActivityFeed site={site} activity={state.activity} />}
          </>
        )}
      </div>
    </section>
  );
}

export function ChatbotsView({ store }: { store: Store }) {
  const states = useSyncStates();
  const { found } = useFound();
  const { service, settings } = store;

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 px-6 pb-10">
        <header className="pt-5">
          <h1 className="text-base font-semibold">Chatbot memory</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-3">
            Turn on sync for a chatbot and OmniMemory keeps its own memory in step with the memories here. Add, edit
            or delete a memory and the change is written to every chatbot it’s shared with. Change or remove it on the
            chatbot’s side and OmniMemory picks that up too. It shows you its first write before making it, never
            takes over or removes something the chatbot had before without asking, and every change can be undone
            below. Syncing uses your normal sign-in on each site and talks only to that site.
          </p>
        </header>

        <div className="flex items-center gap-4 rounded-xl border border-line bg-surface px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px]">Sync in the background</p>
            <p className="text-xs leading-relaxed text-ink-3">
              When a chatbot isn’t open, briefly open it in a background tab to write your changes, then close it.
              Turn off to sync only when you visit the chatbot yourself.
            </p>
          </div>
          <Toggle
            label="Sync in the background"
            checked={settings.syncInBackground}
            onChange={(syncInBackground) => void service.updateSettings({ syncInBackground })}
          />
        </div>

        {found.length > 0 && (
          <a
            href="#/review"
            className="flex items-center gap-3 rounded-xl border border-line-strong bg-surface px-4 py-3 text-[13px] hover:bg-subtle"
          >
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
      </div>
    </div>
  );
}
