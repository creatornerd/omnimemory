import { useEffect, useMemo, useState } from 'react';
import { AlignJustify, GitMerge, Plus, Rows3, Search, X } from 'lucide-react';
import {
  CATEGORIES,
  SITE_IDS,
  SOURCES,
  findDuplicateGroups,
  searchMemories,
  sharingSummary,
  type Category,
  type Memory,
  type SiteId,
  type Source,
} from '../core';
import { SITES, sourceLabel } from '../shared/sites';
import { ConfirmDialog } from '../ui/components/Dialog';
import { MemoryForm } from '../ui/components/MemoryForm';
import { Button, IconButton, Select } from '../ui/components/primitives';
import { useToast } from '../ui/components/Toast';
import { plural } from '../ui/format';
import type { Store } from '../ui/hooks/useStore';
import { MemoryRow } from './MemoryRow';
import { MergeDialog } from './MergeDialog';

type SharingFilter = 'any' | SiteId | 'private' | 'none';
type StatusFilter = 'any' | 'active' | 'outdated';
type DateFilter = 'any' | 'today' | 'week' | 'month' | 'older';
type Sort = 'recent' | 'oldest' | 'alpha';

const DAY = 24 * 60 * 60 * 1000;

function matchesDate(memory: Memory, filter: DateFilter, now: number): boolean {
  if (filter === 'any') return true;
  const age = now - Date.parse(memory.updated_at);
  if (filter === 'today') return age < DAY;
  if (filter === 'week') return age < 7 * DAY;
  if (filter === 'month') return age < 30 * DAY;
  return age >= 30 * DAY;
}

function matchesSharing(memory: Memory, filter: SharingFilter): boolean {
  if (filter === 'any') return true;
  if (filter === 'private') return !memory.enabled;
  if (filter === 'none') return sharingSummary(memory) === 'none';
  return memory.enabled && memory.permissions[filter];
}

interface LibraryProps {
  store: Store;
  category: Category | 'all';
  /** Bumped to open the new-memory form. */
  createRequest?: number;
}

export function Library({ store, category, createRequest = 0 }: LibraryProps) {
  const { service, library, settings, loading } = store;
  const toast = useToast();

  const [query, setQuery] = useState('');
  const [source, setSource] = useState<Source | 'any'>('any');
  const [sharing, setSharing] = useState<SharingFilter>('any');
  const [status, setStatus] = useState<StatusFilter>('any');
  const [date, setDate] = useState<DateFilter>('any');
  const [sort, setSort] = useState<Sort>('recent');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // The welcome tour's "Add your first memory" opens the new-memory form.
  useEffect(() => {
    if (createRequest > 0) setCreating(true);
  }, [createRequest]);
  const [deleting, setDeleting] = useState<Memory[] | null>(null);
  const [merging, setMerging] = useState<Memory[] | null>(null);

  const view = settings.libraryView;

  const visible = useMemo(() => {
    const now = Date.now();
    const filtered = library.filter(
      (memory) =>
        (category === 'all' || memory.category === category) &&
        (source === 'any' || memory.source === source) &&
        (status === 'any' || memory.status === status) &&
        matchesSharing(memory, sharing) &&
        matchesDate(memory, date, now),
    );
    const searched = searchMemories(filtered, query);
    // With a search and the default sort, keep best-match order.
    if (query.trim() && sort === 'recent') return searched;
    const sorted = [...searched];
    if (sort === 'recent') sorted.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    if (sort === 'oldest') sorted.sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (sort === 'alpha') {
      sorted.sort((a, b) => a.content.localeCompare(b.content, undefined, { sensitivity: 'base' }));
    }
    return sorted;
  }, [library, category, source, status, sharing, date, query, sort]);

  // Drop selections that are no longer on screen (filtered out or deleted).
  useEffect(() => {
    setSelected((current) => {
      const ids = new Set(visible.map((memory) => memory.id));
      const next = new Set([...current].filter((id) => ids.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [visible]);

  const duplicateGroups = useMemo(() => findDuplicateGroups(library), [library]);
  const selectedMemories = visible.filter((memory) => selected.has(memory.id));
  const allSelected = visible.length > 0 && selectedMemories.length === visible.length;
  const filtersActive =
    source !== 'any' || sharing !== 'any' || status !== 'any' || date !== 'any' || query.trim() !== '';

  function clearFilters() {
    setQuery('');
    setSource('any');
    setSharing('any');
    setStatus('any');
    setDate('any');
  }

  async function confirmDelete() {
    if (!deleting) return;
    const ids = deleting.map((memory) => memory.id);
    await service.remove(ids);
    setDeleting(null);
    setSelected(new Set());
    toast(`Moved ${plural(ids.length, 'memory', 'memories')} to Recently Deleted`, {
      label: 'Undo',
      run: () => service.restore(ids),
    });
  }

  async function bulkSharing(action: string) {
    const ids = [...selected];
    if (action === 'all') {
      await service.updateMany(ids, {
        enabled: true,
        permissions: { chatgpt: true, claude: true, gemini: true },
      });
    } else if (action === 'private') {
      await service.updateMany(ids, { enabled: false });
    } else {
      const [mode, site] = action.split(':') as ['allow' | 'block', SiteId];
      await service.updateMany(ids, { permissions: { [site]: mode === 'allow' } });
    }
    toast(`Updated sharing for ${plural(ids.length, 'memory', 'memories')}`);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 px-6 pt-5 pb-3">
        <div className="mr-auto">
          <h1 className="text-base font-semibold">{category === 'all' ? 'All memories' : category}</h1>
          <p className="text-xs text-ink-3">
            {loading
              ? 'Loading…'
              : filtersActive
                ? `${visible.length} of ${plural(library.length, 'memory', 'memories')}`
                : plural(visible.length, 'memory', 'memories')}
          </p>
        </div>
        <div className="relative w-64 max-w-full">
          <Search size={14} className="pointer-events-none absolute top-2 left-2.5 text-ink-3" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search memories"
            aria-label="Search memories"
            className="field h-8 pl-8"
          />
        </div>
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
          New memory
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-line px-6 pb-3">
        <Select aria-label="Filter by source" value={source} onChange={(e) => setSource(e.target.value as Source | 'any')}>
          <option value="any">Any source</option>
          {SOURCES.map((value) => (
            <option key={value} value={value}>
              {sourceLabel(value)}
            </option>
          ))}
        </Select>
        <Select aria-label="Filter by sharing" value={sharing} onChange={(e) => setSharing(e.target.value as SharingFilter)}>
          <option value="any">Any sharing</option>
          {SITE_IDS.map((site) => (
            <option key={site} value={site}>
              Shared with {SITES[site].label}
            </option>
          ))}
          <option value="private">Private</option>
          <option value="none">Not shared anywhere</option>
        </Select>
        <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          <option value="any">Any status</option>
          <option value="active">Current</option>
          <option value="outdated">Outdated</option>
        </Select>
        <Select aria-label="Filter by date" value={date} onChange={(e) => setDate(e.target.value as DateFilter)}>
          <option value="any">Any time</option>
          <option value="today">Updated today</option>
          <option value="week">Past 7 days</option>
          <option value="month">Past 30 days</option>
          <option value="older">Older than 30 days</option>
        </Select>
        {filtersActive && (
          <Button size="sm" variant="ghost" icon={<X size={12} />} onClick={clearFilters}>
            Clear
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="recent">{query.trim() ? 'Best match' : 'Most recent'}</option>
            <option value="oldest">Oldest</option>
            <option value="alpha">A → Z</option>
          </Select>
          <div className="flex rounded-md border border-line-strong p-px" role="group" aria-label="View">
            <IconButton
              label="Detailed view"
              className="size-[26px]"
              active={view === 'detailed'}
              aria-pressed={view === 'detailed'}
              onClick={() => void service.updateSettings({ libraryView: 'detailed' })}
            >
              <Rows3 size={14} />
            </IconButton>
            <IconButton
              label="Compact list"
              className="size-[26px]"
              active={view === 'compact'}
              aria-pressed={view === 'compact'}
              onClick={() => void service.updateSettings({ libraryView: 'compact' })}
            >
              <AlignJustify size={14} />
            </IconButton>
          </div>
        </div>
      </div>

      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-canvas px-4 text-xs">
        <input
          type="checkbox"
          className="size-3.5 accent-(--om-accent)"
          aria-label="Select all shown memories"
          checked={allSelected}
          disabled={visible.length === 0}
          onChange={(event) =>
            setSelected(event.target.checked ? new Set(visible.map((m) => m.id)) : new Set())
          }
        />
        {selected.size === 0 ? (
          <span className="pl-1 text-ink-3">Select memories for bulk actions</span>
        ) : (
          <div className="animate-rise flex flex-wrap items-center gap-2 pl-1">
            <span className="font-medium">{selected.size} selected</span>
            <Select
              aria-label="Change sharing for selected"
              value=""
              onChange={(event) => void bulkSharing(event.target.value)}
            >
              <option value="" disabled>
                Sharing…
              </option>
              <option value="all">Share with every chatbot</option>
              <option value="private">Keep private</option>
              {SITE_IDS.map((site) => (
                <option key={`a-${site}`} value={`allow:${site}`}>
                  Allow {SITES[site].label}
                </option>
              ))}
              {SITE_IDS.map((site) => (
                <option key={`b-${site}`} value={`block:${site}`}>
                  Block {SITES[site].label}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Change category for selected"
              value=""
              onChange={(event) =>
                void service
                  .updateMany([...selected], { category: event.target.value as Category })
                  .then((count) => toast(`Moved ${plural(count, 'memory', 'memories')} to ${event.target.value}`))
              }
            >
              <option value="" disabled>
                Category…
              </option>
              {CATEGORIES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              onClick={() => {
                const makeOutdated = selectedMemories.some((m) => m.status === 'active');
                void service.setOutdated([...selected], makeOutdated);
              }}
            >
              {selectedMemories.some((m) => m.status === 'active') ? 'Mark outdated' : 'Mark current'}
            </Button>
            <Button
              size="sm"
              icon={<GitMerge size={13} />}
              disabled={selected.size < 2}
              title={selected.size < 2 ? 'Select two or more memories to merge' : undefined}
              onClick={() => setMerging(selectedMemories)}
            >
              Merge
            </Button>
            <Button size="sm" variant="dangerOutline" onClick={() => setDeleting(selectedMemories)}>
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        )}
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {duplicateGroups.length > 0 && !filtersActive && category === 'all' && (
          <div className="flex items-center gap-3 border-b border-line bg-warn-soft px-4 py-2 text-xs text-warn">
            <span className="flex-1">
              {plural(duplicateGroups.length, 'set')} of memories look like duplicates.
            </span>
            <Button size="sm" icon={<GitMerge size={13} />} onClick={() => setMerging(duplicateGroups[0])}>
              Review{duplicateGroups.length > 1 ? ' first set' : ''}
            </Button>
          </div>
        )}

        {creating && (
          <div className="animate-rise border-b border-line bg-surface px-4 py-3.5">
            <MemoryForm
              defaultPermissions={settings.defaultPermissions}
              existing={library}
              submitLabel="Save memory"
              onSubmit={async (values) => {
                await service.create({ ...values, source: 'manual' });
                setCreating(false);
                toast('Memory saved');
              }}
              onCancel={() => setCreating(false)}
            />
          </div>
        )}

        {!loading && visible.length === 0 && !creating && (
          <div className="mx-auto max-w-sm px-6 py-16 text-center">
            <p className="text-sm font-medium">
              {library.length === 0 ? 'Nothing saved yet' : 'No memories match'}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
              {library.length === 0
                ? 'Add a memory here, or select text on any page and choose “Save selection to OmniMemory”. Memories are stored on this device.'
                : 'Try a different search, or clear the filters.'}
            </p>
            <div className="mt-4">
              {library.length === 0 ? (
                <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
                  New memory
                </Button>
              ) : (
                <Button onClick={clearFilters}>Clear filters</Button>
              )}
            </div>
          </div>
        )}

        <ul>
          {visible.map((memory) => (
            <MemoryRow
              key={memory.id}
              memory={memory}
              library={library}
              settings={settings}
              service={service}
              view={view}
              selected={selected.has(memory.id)}
              editing={editingId === memory.id}
              onSelect={(on) =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (on) next.add(memory.id);
                  else next.delete(memory.id);
                  return next;
                })
              }
              onEdit={(on) => setEditingId(on ? memory.id : null)}
              onDelete={() => setDeleting([memory])}
            />
          ))}
        </ul>
      </div>

      <ConfirmDialog
        open={deleting !== null}
        title={deleting && deleting.length > 1 ? `Delete ${deleting.length} memories?` : 'Delete this memory?'}
        confirmLabel="Move to Recently Deleted"
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      >
        {deleting?.length === 1 && (
          <p className="rounded-md bg-subtle px-2.5 py-2 text-ink">“{deleting[0].content}”</p>
        )}
        <p>
          It stops being shared right away and stays in Recently Deleted for 30 days, where you can
          restore it.
        </p>
        <p className="text-xs text-ink-3">
          With chatbot memory sync on, it’s also removed from ChatGPT’s and Gemini’s memory. Anything a
          chatbot learned on its own from your chats is separate and stays there.
        </p>
      </ConfirmDialog>

      <MergeDialog
        memories={merging}
        service={service}
        onClose={(merged) => {
          setMerging(null);
          if (merged) setSelected(new Set());
        }}
      />
    </div>
  );
}
