import { useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, Inbox, Search } from 'lucide-react';
import {
  BLOCK_LIMITS,
  CATEGORIES,
  SITE_IDS,
  SOURCES,
  SYNC_MODES,
  SYNC_TARGETS,
  renderBlock,
  shareableMemories,
  syncBlocked,
  type Category,
  type SiteId,
  type Source,
} from '../core';
import { SITES, sourceLabel } from '../shared/sites';
import { Button } from '../ui/components/primitives';
import { ShareDots } from '../ui/components/ShareDots';
import { cx, plural, timeAgo } from '../ui/format';
import type { HeldItem } from '../ui/hooks/useFound';
import type { FoundItem } from '../core/discover';
import type { Store } from '../ui/hooks/useStore';
import { StatusLine, useSyncStates } from './ChatbotsView';
import { Help, type HelpId } from './help';

const SOURCE_COLORS: Record<Source, string> = {
  manual: 'var(--om-ink)',
  chatgpt: SITES.chatgpt.color,
  claude: SITES.claude.color,
  gemini: SITES.gemini.color,
  selection: 'var(--om-brand)',
  import: 'var(--om-line-strong)',
};

interface HomeViewProps {
  store: Store;
  found: FoundItem[];
  held: HeldItem[];
  onSearch: (query: string) => void;
  onCategory: (category: Category) => void;
  onNavigate: (view: 'library' | 'review' | 'chatbots') => void;
  onCreate: () => void;
}

function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-[14px] border border-line bg-surface', className)}>{children}</div>;
}

function SectionTitle({ children, action, help }: { children: ReactNode; action?: ReactNode; help?: HelpId }) {
  return (
    <div className="mt-9 mb-3 flex items-baseline justify-between">
      <h2 className="flex items-center gap-1.5 text-[15px] font-semibold">
        {children}
        {help && <Help id={help} />}
      </h2>
      {action}
    </div>
  );
}

function TextLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-[13px] font-medium text-brand hover:text-brand-hover hover:underline">
      {children}
    </button>
  );
}

function ChatbotCard({ site, store, state }: { site: SiteId; store: Store; state: ReturnType<typeof useSyncStates>[SiteId] }) {
  const info = SITES[site];
  const shared = shareableMemories(store.library, store.settings, site).length;
  const blocked = syncBlocked(store.settings, site);
  const limits = SYNC_MODES[site] === 'block' ? BLOCK_LIMITS[site] : undefined;
  const used = limits && state ? renderBlock(state.links.map((link) => link.pushedText)).length : 0;
  const share = limits ? Math.min(100, Math.round((used / limits.block) * 100)) : 0;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <span className="size-[9px] rounded-full" style={{ background: info.color }} />
        <span className="text-sm font-semibold">{info.label}</span>
        <span className="ml-auto">
          <StatusLine site={site} state={state} store={store} />
        </span>
      </div>
      <div className="mt-3.5 text-[12.5px] text-ink-2">{plural(shared, 'memory', 'memories')} shared</div>
      {blocked === 'off' ? (
        <p className="mt-2.5 text-[11.5px] leading-snug text-ink-3">
          Still added to chats when you choose. Its own memory isn’t updated.
        </p>
      ) : limits && state?.lastSyncAt ? (
        <>
          <div className="mt-2.5 h-[5px] rounded-full bg-muted">
            <div className="h-full rounded-full" style={{ width: `${share}%`, background: info.color }} />
          </div>
          <div className="mt-1.5 text-[11.5px] text-ink-3 tabular-nums">
            {used.toLocaleString()} of {limits.block.toLocaleString()} characters used
          </div>
        </>
      ) : (
        <div className="mt-2.5 text-[11.5px] text-ink-3">Writes to {SYNC_TARGETS[site]}</div>
      )}
    </Card>
  );
}

export function HomeView({ store, found, held, onSearch, onCategory, onNavigate, onCreate }: HomeViewProps) {
  const { library, settings, loading } = store;
  const states = useSyncStates();
  const [query, setQuery] = useState('');

  const recent = useMemo(
    () =>
      [...library]
        .sort((a, b) => (b.last_used_at ?? b.updated_at).localeCompare(a.last_used_at ?? a.updated_at))
        .slice(0, 5),
    [library],
  );
  const categories = useMemo(() => {
    const counts = new Map<Category, number>();
    for (const memory of library) counts.set(memory.category, (counts.get(memory.category) ?? 0) + 1);
    const max = Math.max(1, ...counts.values());
    return CATEGORIES.map((category) => ({ category, count: counts.get(category) ?? 0, width: ((counts.get(category) ?? 0) / max) * 100 }));
  }, [library]);
  const sources = useMemo(() => {
    const counts = new Map<Source, number>();
    for (const memory of library) counts.set(memory.source, (counts.get(memory.source) ?? 0) + 1);
    return SOURCES.map((source) => ({ source, count: counts.get(source) ?? 0 })).filter((entry) => entry.count > 0);
  }, [library]);

  const heldBySite = SITE_IDS.map((site) => ({ site, items: held.filter((item) => item.site === site) })).filter(
    (group) => group.items.length > 0,
  );
  const needsYou = heldBySite.length > 0 || found.length > 0;
  const sharedWith = SITE_IDS.filter((site) => shareableMemories(library, settings, site).length > 0).map((site) => SITES[site].label);

  return (
    <div className="scroll-thin flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1080px] px-10 pt-10 pb-16 max-md:px-5">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Your memory</h1>
        <p className="mt-1.5 mb-5 text-sm text-ink-2">
          {loading
            ? 'Loading…'
            : settings.sharingPaused
              ? `${plural(library.length, 'memory', 'memories')} on this device. Sharing is paused.`
              : sharedWith.length > 0
                ? `${plural(library.length, 'memory', 'memories')} on this device, shared with ${listWords(sharedWith)}.`
                : `${plural(library.length, 'memory', 'memories')} on this device.`}
        </p>

        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            onSearch(query.trim());
          }}
          className="flex h-[50px] items-center gap-2.5 rounded-xl border border-line-strong bg-surface px-4 shadow-[0_1px_2px_rgb(20_20_18/0.04)] focus-within:border-brand"
        >
          <Search size={17} className="text-ink-3" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search everything you’ve saved"
            aria-label="Search memories"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
          />
          <span className="rounded-[5px] border border-line px-[7px] py-0.5 font-mono text-[11px] text-ink-3">Enter</span>
          <Help id="home.search" />
        </form>

        {needsYou && (
          <>
            <SectionTitle help="home.needs">Needs you</SectionTitle>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3.5">
              {heldBySite.map(({ site, items }) => (
                <Card key={site} className="flex flex-col gap-2.5 border-[color-mix(in_srgb,var(--om-warn)_28%,transparent)] p-[18px]">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-warn">
                    <span className="size-2 rounded-full" style={{ background: SITES[site].color }} />
                    {SITES[site].label} · {plural(items.length, 'change needs', 'changes need')} your OK
                  </div>
                  <p className="text-[13.5px] leading-relaxed text-ink-2">{describeHeld(items[0], site)}</p>
                  <div className="mt-1 flex gap-2">
                    <Button variant="primary" onClick={() => onNavigate('chatbots')}>
                      See details
                    </Button>
                  </div>
                </Card>
              ))}
              {found.length > 0 && (
                <Card className="flex flex-col gap-2.5 p-[18px]">
                  <div className="flex items-center gap-2 text-[13px] font-semibold">
                    <Inbox size={15} className="text-ink-2" />
                    {plural(found.length, 'thing', 'things')} to review
                  </div>
                  <p className="text-[13.5px] leading-relaxed text-ink-2">
                    Your chatbots remember things OmniMemory doesn’t have yet, like “{found[0].text}”
                  </p>
                  <div className="mt-1 flex gap-2">
                    <Button variant="primary" onClick={() => onNavigate('review')}>
                      Review
                    </Button>
                  </div>
                </Card>
              )}
            </div>
          </>
        )}

        <SectionTitle help="home.chatbots" action={<TextLink onClick={() => onNavigate('chatbots')}>Manage sync</TextLink>}>
          Chatbots
        </SectionTitle>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3.5">
          {SITE_IDS.map((site) => (
            <ChatbotCard key={site} site={site} store={store} state={states[site]} />
          ))}
        </div>

        <div className="mt-9 flex flex-wrap items-start gap-3.5">
          <Card className="min-w-0 flex-[1.6_1_420px] overflow-hidden">
            <div className="flex items-baseline justify-between px-[18px] pt-4 pb-2">
              <h2 className="flex items-center gap-1.5 text-[15px] font-semibold">
                Recently used <Help id="home.recent" />
              </h2>
              <TextLink onClick={() => onNavigate('library')}>See all memories</TextLink>
            </div>
            {recent.length === 0 && !loading ? (
              <div className="border-t border-line px-[18px] py-10 text-center">
                <p className="text-sm font-semibold">Nothing saved yet</p>
                <p className="mt-1 mb-3.5 text-[13px] text-ink-3">Save one short fact you’d like every chatbot to know.</p>
                <Button variant="primary" onClick={onCreate}>
                  New memory
                </Button>
              </div>
            ) : (
              recent.map((memory) => (
                <div key={memory.id} className="border-t border-line px-[18px] py-3">
                  <div className={cx('text-sm leading-normal', memory.enabled ? 'text-ink' : 'text-ink-2')}>{memory.content}</div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-ink-3">
                    {memory.enabled ? (
                      <ShareDots memory={memory} />
                    ) : (
                      <span className="rounded bg-muted px-1.5 text-[11px] font-medium text-ink-2">Private</span>
                    )}
                    <span>
                      {memory.category} ·{' '}
                      {memory.last_used_at ? `used ${timeAgo(memory.last_used_at)}` : `updated ${timeAgo(memory.updated_at)}`}
                    </span>
                  </div>
                </div>
              ))
            )}
          </Card>

          <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3.5">
            <Card className="px-[18px] pt-4 pb-2.5">
              <h2 className="mb-2 flex items-center gap-1.5 text-[15px] font-semibold">
                Categories <Help id="home.categories" />
              </h2>
              {categories.map(({ category, count, width }) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => onCategory(category)}
                  className="block w-full py-[7px] text-left"
                >
                  <span className="flex justify-between text-[13px]">
                    <span>{category}</span>
                    <span className="text-ink-3 tabular-nums">{count}</span>
                  </span>
                  <span className="mt-1.5 block h-1 rounded-full bg-muted">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
                  </span>
                </button>
              ))}
            </Card>
            {sources.length > 0 && (
              <Card className="px-[18px] py-4">
                <h2 className="mb-3 flex items-center gap-1.5 text-[15px] font-semibold">
                  Where they came from <Help id="home.sources" />
                </h2>
                <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
                  {sources.map(({ source, count }) => (
                    <span key={source} style={{ width: `${(count / library.length) * 100}%`, background: SOURCE_COLORS[source] }} />
                  ))}
                </div>
                <div className="mt-3.5 grid grid-cols-2 gap-x-3.5 gap-y-2">
                  {sources.map(({ source, count }) => (
                    <div key={source} className="flex items-center gap-[7px] text-[12.5px] text-ink-2">
                      <span className="size-2 shrink-0 rounded-[2px]" style={{ background: SOURCE_COLORS[source] }} />
                      <span className="flex-1">{sourceLabel(source)}</span>
                      <span className="text-ink-3 tabular-nums">{count}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onCreate}
          className="mt-9 flex w-full items-center gap-3 rounded-xl border border-line-strong bg-surface px-4 py-3.5 text-left text-[13.5px] hover:bg-subtle"
        >
          <span className="flex-1">
            <b className="font-semibold">Add a memory.</b>{' '}
            <span className="text-ink-2">One short fact you’d like every chatbot to know.</span>
          </span>
          <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

function listWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function describeHeld(item: HeldItem, site: SiteId): string {
  const name = SITES[site].label;
  if (item.kind === 'first-write') return `Preview what OmniMemory would write to ${name} before anything changes.`;
  if (item.kind === 'adopt') return `${name} already has “${item.remoteText ?? item.memoryText ?? ''}”. Link it to your memory, or leave ${name}'s copy alone?`;
  return `Remove “${item.remoteText ?? item.memoryText ?? ''}” from ${name}? OmniMemory didn’t put it there.`;
}
