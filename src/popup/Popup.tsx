import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, ChevronRight, CircleAlert, Inbox, Plus, Search, Settings, Trash2, X } from 'lucide-react';
import { SITE_IDS, searchMemories, type Memory } from '../core';
import { SITES } from '../shared/sites';
import { ShareDots } from '../ui/components/ShareDots';
import { openDashboard, takePendingCapture } from '../shared/platform';
import { MemoryForm, type MemoryFormValues } from '../ui/components/MemoryForm';
import { Badge, Button, IconButton, Logo, Toggle } from '../ui/components/primitives';
import { useToast } from '../ui/components/Toast';
import { ThemeToggle } from '../ui/components/ThemeToggle';
import { cx, plural, timeAgo } from '../ui/format';
import { useFound } from '../ui/hooks/useFound';
import { useStore } from '../ui/hooks/useStore';
import { repeatCheck } from '../ui/hooks/repeat-check';

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
  const { found, held } = useFound();
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
    <div className="flex h-[560px] w-[380px] flex-col bg-surface">
      <header className="flex items-center gap-[9px] pt-3.5 pr-3.5 pb-2.5 pl-4">
        <Logo size={22} />
        <h1 className="flex-1 text-sm font-semibold tracking-[-0.01em]">OmniMemory</h1>
        <ThemeToggle theme={settings.theme} onChange={(theme) => void service.updateSettings({ theme })} />
        <IconButton label="Settings" onClick={() => void openDashboard('settings')}>
          <Settings size={15} />
        </IconButton>
      </header>

      <label className="mx-3 flex items-center gap-2.5 rounded-[10px] bg-subtle px-3 py-2.5">
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium">{paused ? 'Sharing paused' : 'Sharing with chatbots'}</span>
          <span className="mt-0.5 flex items-center gap-2 text-[11.5px] text-ink-2">
            {paused
              ? 'No chatbot gets any memory until you turn this on.'
              : SITE_IDS.map((site) => (
                  <span key={site} className="flex items-center gap-1">
                    <span className="size-1.5 rounded-full" style={{ background: SITES[site].color }} />
                    {SITES[site].label}
                  </span>
                ))}
          </span>
        </span>
        <Toggle
          label="Share memories with chatbots"
          checked={!paused}
          onChange={(on) => void service.updateSettings({ sharingPaused: !on })}
        />
      </label>

      {(found.length > 0 || held.length > 0) && (
        <div className="mx-3 mt-2.5 overflow-hidden rounded-[10px] border border-line">
          {held.length > 0 && (
            <button
              type="button"
              onClick={() => void openDashboard('chatbots')}
              className="flex w-full items-center gap-[9px] bg-warn-soft px-3 py-[9px] text-left text-[12.5px] text-warn hover:opacity-90"
            >
              <CircleAlert size={14} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                <b className="font-semibold">{plural(held.length, 'change', 'changes')}</b> need your OK
              </span>
              <ChevronRight size={14} className="shrink-0" />
            </button>
          )}
          {found.length > 0 && (
            <button
              type="button"
              onClick={() => void openDashboard('review')}
              className={cx(
                'flex w-full items-center gap-[9px] px-3 py-[9px] text-left text-[12.5px] hover:bg-subtle',
                held.length > 0 && 'border-t border-line',
              )}
            >
              <Inbox size={14} className="shrink-0 text-ink-2" />
              <span className="min-w-0 flex-1 truncate">
                <b className="font-semibold">{plural(found.length, 'thing', 'things')}</b> your chatbots know to review
              </span>
              <ChevronRight size={14} className="shrink-0 text-ink-3" />
            </button>
          )}
        </div>
      )}

      <div className="flex gap-2 px-3 pt-3 pb-2">
        <div className="relative min-w-0 flex-1">
          <Search size={14} className="pointer-events-none absolute top-[10px] left-2.5 text-ink-3" />
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search memories"
            aria-label="Search memories"
            className="field h-[34px] pr-8 pl-8"
          />
          {query && (
            <IconButton label="Clear search" className="absolute top-0.5 right-0.5" onClick={() => setQuery('')}>
              <X size={13} />
            </IconButton>
          )}
        </div>
        <Button
          variant="primary"
          icon={<Plus size={14} />}
          onClick={() => {
            setCaptured(null);
            setComposing(true);
          }}
        >
          New
        </Button>
      </div>

      <main className="scroll-thin min-h-0 flex-1 overflow-y-auto">
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
              checkRepeats={repeatCheck(settings, library)}
              submitLabel="Save memory"
              onSubmit={saveNew}
              onCancel={() => {
                setComposing(false);
                setCaptured(null);
              }}
            />
          </section>
        )}

        <h2 className="px-4 pt-1.5 pb-1 text-[11.5px] font-semibold text-ink-3">
          {query.trim() ? plural(results.length, 'result') : 'Recent'}
        </h2>

        {!loading && results.length === 0 && (
          <p className="px-3.5 py-6 text-center text-xs leading-relaxed text-ink-3">
            {query.trim() ? 'No memories match that search.' : 'Nothing saved yet. Press New memory to add one.'}
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
                    checkRepeats={repeatCheck(settings, library, memory.id)}
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
                <div className="flex items-start gap-1 py-[9px] pr-2 pl-4 transition-colors hover:bg-subtle">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    title="Edit this memory"
                    onClick={() => setEditingId(memory.id)}
                  >
                    <p
                      className={cx(
                        'line-clamp-2 text-[13px] leading-[1.45]',
                        (!memory.enabled || memory.status === 'outdated') && 'text-ink-2',
                      )}
                    >
                      {memory.content}
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-[11px] text-ink-3">
                      {memory.enabled ? <ShareDots memory={memory} /> : <Badge>Private</Badge>}
                      {memory.status === 'outdated' && <Badge tone="warn">Outdated</Badge>}
                      <span>
                        {memory.category} ·{' '}
                        {memory.last_used_at ? `used ${timeAgo(memory.last_used_at)}` : `updated ${timeAgo(memory.updated_at)}`}
                      </span>
                    </p>
                  </button>
                  <div className="flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
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

      <footer className="flex items-center gap-2 border-t border-line bg-canvas px-3 py-2.5">
        <Button variant="ghost" onClick={() => void openDashboard('home')}>
          Open dashboard
          <ArrowUpRight size={14} />
        </Button>
        <span className="ml-auto text-[11.5px] text-ink-3">{plural(library.length, 'memory', 'memories')} on this device</span>
      </footer>
    </div>
  );
}
