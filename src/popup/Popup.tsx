import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Inbox, Plus, Search, Trash2, X } from 'lucide-react';
import { searchMemories, type Memory } from '../core';
import { openDashboard, takePendingCapture } from '../shared/platform';
import { MemoryForm, type MemoryFormValues } from '../ui/components/MemoryForm';
import { Badge, Button, IconButton, Logo, Toggle } from '../ui/components/primitives';
import { useToast } from '../ui/components/Toast';
import { cx, plural } from '../ui/format';
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
    <div className="flex h-[560px] w-[380px] flex-col bg-canvas">
      <header className="flex items-center gap-2 px-3.5 pt-3 pb-2.5">
        <Logo size={20} />
        <h1 className="flex-1 text-[13px] font-semibold">OmniMemory</h1>
        <label
          className="flex items-center gap-2 text-[11px] text-ink-2"
          title={paused ? 'No chatbot gets any memory until you turn this back on' : 'Chatbots can receive the memories you share'}
        >
          {paused ? 'Paused' : 'Sharing'}
          <Toggle
            label="Share memories with chatbots"
            checked={!paused}
            onChange={(on) => void service.updateSettings({ sharingPaused: !on })}
          />
        </label>
      </header>

      {(found.length > 0 || held.length > 0) && (
        <button
          type="button"
          onClick={() => void openDashboard(held.length > 0 ? 'chatbots' : 'review')}
          className={cx(
            'mx-3.5 mb-2.5 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs hover:opacity-90',
            held.length > 0 ? 'bg-warn-soft text-warn' : 'bg-subtle text-ink-2',
          )}
        >
          <Inbox size={13} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {[
              held.length > 0 ? `${plural(held.length, 'change needs', 'changes need')} your OK` : '',
              found.length > 0 ? `${found.length} to review` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <ArrowUpRight size={13} className="shrink-0" />
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

        {query.trim() && (
          <h2 className="px-3.5 pt-2.5 pb-1 text-[11px] text-ink-3">{plural(results.length, 'result')}</h2>
        )}

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
                    {(!memory.enabled || memory.status === 'outdated') && (
                      <p className="mt-1 flex items-center gap-1.5">
                        {!memory.enabled && <Badge>Private</Badge>}
                        {memory.status === 'outdated' && <Badge tone="warn">Outdated</Badge>}
                      </p>
                    )}
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

      <footer className="flex items-center gap-2 border-t border-line bg-surface px-3.5 py-2.5">
        <Button
          variant="primary"
          icon={<Plus size={14} />}
          onClick={() => {
            setCaptured(null);
            setComposing(true);
          }}
        >
          New memory
        </Button>
        <Button className="ml-auto" variant="ghost" icon={<ArrowUpRight size={14} />} onClick={() => void openDashboard('library')}>
          Open OmniMemory
        </Button>
      </footer>
    </div>
  );
}
