import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Eye, EyeOff, Inbox, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { searchMemories, type Memory, type SiteId } from '../core';
import { openDashboard, takePendingCapture } from '../shared/platform';
import { SITE_LIST } from '../shared/sites';
import { MemoryForm, type MemoryFormValues } from '../ui/components/MemoryForm';
import { Badge, Button, IconButton, Logo, Toggle } from '../ui/components/primitives';
import { useToast } from '../ui/components/Toast';
import { cx, plural, timeAgo } from '../ui/format';
import { useFound } from '../ui/hooks/useFound';
import { useStore } from '../ui/hooks/useStore';

const RECENT_LIMIT = 8;
const SEARCH_LIMIT = 40;

function recency(memory: Memory): string {
  return memory.last_used_at && memory.last_used_at > memory.updated_at
    ? memory.last_used_at
    : memory.updated_at;
}

export function Popup() {
  const { service, library, settings, loading } = useStore();
  const toast = useToast();
  const { found } = useFound();
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [captured, setCaptured] = useState<string | null>(null);

  // Text sent from the right-click menu waits here for review.
  useEffect(() => {
    void takePendingCapture().then((pending) => {
      if (pending) {
        setCaptured(pending.text);
        setComposing(true);
      }
    });
  }, []);

  const results = useMemo(() => {
    if (query.trim()) return searchMemories(library, query).slice(0, SEARCH_LIMIT);
    return [...library].sort((a, b) => recency(b).localeCompare(recency(a))).slice(0, RECENT_LIMIT);
  }, [library, query]);

  async function saveNew(values: MemoryFormValues) {
    await service.create({ ...values, source: captured !== null ? 'selection' : 'manual' });
    setComposing(false);
    setCaptured(null);
    toast('Memory saved');
  }

  async function remove(memory: Memory) {
    await service.remove([memory.id]);
    setConfirmingId(null);
    toast('Moved to Recently Deleted', { label: 'Undo', run: () => service.restore([memory.id]) });
  }

  const paused = settings.sharingPaused;

  return (
    <div className="flex h-[560px] w-[380px] flex-col bg-canvas">
      <header className="flex items-center gap-2 px-3.5 pt-3 pb-2.5">
        <Logo size={22} />
        <div className="min-w-0 flex-1 leading-tight">
          <h1 className="text-[13px] font-semibold">OmniMemory</h1>
          <p className="text-[11px] text-ink-3" aria-live="polite">
            {loading ? 'Loading…' : `${plural(library.length, 'memory', 'memories')} stored on this device`}
          </p>
        </div>
        <label className="flex items-center gap-2 text-[11px] font-medium text-ink-2">
          {paused ? 'Sharing paused' : 'Sharing on'}
          <Toggle
            label="Share memories with chatbots"
            checked={!paused}
            onChange={(on) => void service.updateSettings({ sharingPaused: !on })}
          />
        </label>
      </header>

      <div className="flex items-center gap-1.5 px-3.5 pb-2.5" role="group" aria-label="Chatbots that can receive memories">
        {SITE_LIST.map((site) => {
          const sitePaused = settings.sitePaused[site.id];
          const live = !paused && !sitePaused;
          return (
            <button
              key={site.id}
              type="button"
              role="switch"
              aria-checked={!sitePaused}
              disabled={paused}
              title={
                paused
                  ? 'Sharing is paused everywhere'
                  : sitePaused
                    ? `${site.label} is paused — click to resume`
                    : `${site.label} can receive memories — click to pause`
              }
              onClick={() =>
                void service.updateSettings({ sitePaused: { [site.id]: !sitePaused } as Record<SiteId, boolean> })
              }
              className={cx(
                'inline-flex h-6 flex-1 items-center justify-center gap-1.5 rounded-md border text-[11px] font-medium transition-colors',
                live ? 'border-line bg-surface text-ink' : 'border-transparent bg-subtle text-ink-3',
                !paused && 'hover:border-line-strong',
              )}
            >
              <span
                className="size-1.5 rounded-full"
                style={{ background: live ? site.color : 'var(--om-ink-3)' }}
              />
              {site.label}
              {!live && <span className="font-normal">· off</span>}
            </button>
          );
        })}
      </div>

      {found.length > 0 && (
        <button
          type="button"
          onClick={() => void openDashboard('review')}
          className="mx-3.5 mb-2.5 flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-2.5 py-2 text-left text-xs hover:bg-subtle"
        >
          <Inbox size={14} className="shrink-0 text-ink-2" />
          <span className="min-w-0 flex-1">
            <strong className="font-semibold">{plural(found.length, 'thing', 'things')} found on your chatbots.</strong>{' '}
            <span className="text-ink-2">Review</span>
          </span>
          <ArrowUpRight size={13} className="shrink-0 text-ink-3" />
        </button>
      )}

      <div className="relative px-3.5 pb-2">
        <Search size={14} className="pointer-events-none absolute top-2 left-6 text-ink-3" />
        <input
          type="search"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search memories"
          aria-label="Search memories"
          className="field h-8 pr-8 pl-8"
        />
        {query && (
          <IconButton
            label="Clear search"
            className="absolute top-0.5 right-4"
            onClick={() => setQuery('')}
          >
            <X size={13} />
          </IconButton>
        )}
      </div>

      <main className="scroll-thin min-h-0 flex-1 overflow-y-auto border-t border-line">
        {composing && (
          <section className="animate-rise border-b border-line bg-surface px-3.5 py-3">
            <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
              {captured !== null ? 'Review before saving' : 'New memory'}
            </h2>
            <MemoryForm
              compact
              initial={{ content: captured ?? '' }}
              defaultPermissions={settings.defaultPermissions}
              existing={library}
              submitLabel="Save memory"
              onSubmit={saveNew}
              onCancel={() => {
                setComposing(false);
                setCaptured(null);
              }}
            />
          </section>
        )}

        <h2 className="px-3.5 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
          {query.trim() ? plural(results.length, 'result') : 'Recent'}
        </h2>

        {!loading && results.length === 0 && (
          <p className="px-3.5 py-6 text-center text-xs leading-relaxed text-ink-3">
            {query.trim()
              ? 'No memories match that search.'
              : 'No memories yet. Save one and it will be available on ChatGPT, Claude and Gemini.'}
          </p>
        )}

        <ul>
          {results.map((memory) => (
            <li key={memory.id} className="group border-b border-line last:border-b-0">
              {editingId === memory.id ? (
                <div className="bg-surface px-3.5 py-3">
                  <MemoryForm
                    compact
                    editingId={memory.id}
                    initial={memory}
                    defaultPermissions={settings.defaultPermissions}
                    existing={library}
                    submitLabel="Save"
                    onSubmit={async (values) => {
                      await service.update(memory.id, values);
                      setEditingId(null);
                      toast('Memory updated');
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                </div>
              ) : confirmingId === memory.id ? (
                <div className="flex items-center gap-2 bg-danger-soft px-3.5 py-2.5">
                  <p className="min-w-0 flex-1 truncate text-xs text-danger">
                    Delete “{memory.content}”?
                  </p>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmingId(null)}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="danger" autoFocus onClick={() => void remove(memory)}>
                    Delete
                  </Button>
                </div>
              ) : (
                <div className="flex items-start gap-1 py-2 pr-2 pl-3.5 transition-colors hover:bg-subtle">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    title="Edit this memory"
                    onClick={() => setEditingId(memory.id)}
                  >
                    <p
                      className={cx(
                        'line-clamp-2 text-[13px] leading-snug',
                        (!memory.enabled || memory.status === 'outdated') && 'text-ink-2',
                      )}
                    >
                      {memory.content}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-3">
                      <span>{memory.category}</span>
                      <span aria-hidden>·</span>
                      <span>{timeAgo(recency(memory))}</span>
                      {!memory.enabled && <Badge>Private</Badge>}
                      {memory.status === 'outdated' && <Badge tone="warn">Outdated</Badge>}
                    </p>
                  </button>
                  <div className="flex opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    <IconButton
                      label={memory.enabled ? 'Hide from chatbots (keep private)' : 'Share with chatbots again'}
                      onClick={() => void service.update(memory.id, { enabled: !memory.enabled })}
                    >
                      {memory.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
                    </IconButton>
                    <IconButton label="Edit" onClick={() => setEditingId(memory.id)}>
                      <Pencil size={14} />
                    </IconButton>
                    <IconButton label="Delete" tone="danger" onClick={() => setConfirmingId(memory.id)}>
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </main>

      <footer className="flex items-center gap-2 border-t border-line bg-surface px-3.5 py-2.5">
        <Button
          variant="primary"
          icon={<Plus size={14} />}
          onClick={() => {
            setCaptured(null);
            setComposing(true);
          }}
        >
          Save memory
        </Button>
        <Button className="ml-auto" icon={<ArrowUpRight size={14} />} onClick={() => void openDashboard('library')}>
          Manage all memories
        </Button>
      </footer>
    </div>
  );
}
