import { CircleSlash, History, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import type { Memory, MemoryService, Settings } from '../core';
import { sourceLabel } from '../shared/sites';
import { MemoryForm } from '../ui/components/MemoryForm';
import { Badge, IconButton } from '../ui/components/primitives';
import { SiteToggles } from '../ui/components/SiteToggles';
import { useToast } from '../ui/components/Toast';
import { cx, fullDate, timeAgo } from '../ui/format';

interface MemoryRowProps {
  memory: Memory;
  library: Memory[];
  settings: Settings;
  service: MemoryService;
  view: 'compact' | 'detailed';
  selected: boolean;
  editing: boolean;
  onSelect: (selected: boolean) => void;
  onEdit: (editing: boolean) => void;
  onDelete: () => void;
}

const HISTORY_LABELS: Record<string, string> = {
  created: 'Created',
  imported: 'Imported',
  edited: 'Edited',
  merged: 'Merged',
  'marked-outdated': 'Marked outdated',
  'marked-current': 'Marked current',
  deleted: 'Deleted',
  restored: 'Restored',
};

function HistoryList({ memory }: { memory: Memory }) {
  const entries = [...memory.history].reverse();
  return (
    <details className="rounded-md border border-line text-xs">
      <summary className="flex items-center gap-1.5 px-2.5 py-1.5 text-ink-2 select-none hover:text-ink">
        <History size={12} />
        History · {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
      </summary>
      <ol className="scroll-thin max-h-40 space-y-1.5 overflow-y-auto border-t border-line px-2.5 py-2">
        {entries.map((entry, index) => (
          <li key={`${entry.at}-${index}`} className="text-ink-2">
            <span className="font-medium text-ink">{HISTORY_LABELS[entry.action] ?? entry.action}</span>
            <span className="text-ink-3"> · {fullDate(entry.at)}</span>
            {entry.note && <span className="text-ink-3"> · {entry.note}</span>}
            {entry.previous?.content && (
              <p className="mt-0.5 border-l-2 border-line-strong pl-2 text-ink-3">
                Was: {entry.previous.content}
              </p>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

export function MemoryRow({
  memory,
  library,
  settings,
  service,
  view,
  selected,
  editing,
  onSelect,
  onEdit,
  onDelete,
}: MemoryRowProps) {
  const toast = useToast();
  const outdated = memory.status === 'outdated';
  const compact = view === 'compact';

  if (editing) {
    return (
      <li className="animate-rise border-b border-line bg-surface px-4 py-3.5">
        <MemoryForm
          editingId={memory.id}
          initial={memory}
          defaultPermissions={settings.defaultPermissions}
          existing={library}
          submitLabel="Save changes"
          onSubmit={async (values) => {
            await service.update(memory.id, values);
            onEdit(false);
            toast('Memory updated');
          }}
          onCancel={() => onEdit(false)}
        >
          <HistoryList memory={memory} />
        </MemoryForm>
      </li>
    );
  }

  return (
    <li
      className={cx(
        'group flex gap-3 border-b border-line px-4 transition-colors',
        compact ? 'items-center py-1.5' : 'items-start py-3',
        selected ? 'bg-subtle' : 'hover:bg-subtle',
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={(event) => onSelect(event.target.checked)}
        aria-label={`Select memory: ${memory.content.slice(0, 60)}`}
        className={cx('size-3.5 shrink-0 accent-(--om-accent)', !compact && 'mt-1')}
      />

      <button
        type="button"
        onClick={() => onEdit(true)}
        title="Click to edit"
        className="min-w-0 flex-1 rounded-sm text-left"
      >
        <p
          className={cx(
            'text-[13px] leading-relaxed',
            compact ? 'truncate' : 'line-clamp-3 whitespace-pre-line',
            (outdated || !memory.enabled) && 'text-ink-2',
            outdated && 'line-through decoration-ink-3',
          )}
        >
          {memory.content}
        </p>
        {!compact && (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-3">
            <Badge>{memory.category}</Badge>
            {outdated && <Badge tone="warn">Outdated</Badge>}
            {memory.tags.map((tag) => (
              <span key={tag}>#{tag}</span>
            ))}
            <span>{sourceLabel(memory.source)}</span>
            <span aria-hidden>·</span>
            <span title={fullDate(memory.updated_at)}>Updated {timeAgo(memory.updated_at)}</span>
          </p>
        )}
      </button>

      {compact && (
        <span className="hidden shrink-0 items-center gap-2 text-[11px] text-ink-3 md:flex">
          {outdated && <Badge tone="warn">Outdated</Badge>}
          <span className="w-20 truncate">{memory.category}</span>
          <span className="w-14 text-right">{timeAgo(memory.updated_at)}</span>
        </span>
      )}

      <div className="flex shrink-0 items-center gap-2">
        <SiteToggles
          permissions={memory.permissions}
          enabled={memory.enabled}
          onPermission={(site, allowed) =>
            void service.update(memory.id, { permissions: { [site]: allowed } })
          }
          onEnabled={(enabled) => void service.update(memory.id, { enabled })}
        />
        <div className="flex">
          <IconButton label="Edit" onClick={() => onEdit(true)}>
            <Pencil size={14} />
          </IconButton>
          <IconButton
            label={outdated ? 'Mark as current' : 'Mark as outdated (stops sharing, keeps the memory)'}
            active={outdated}
            onClick={() => void service.setOutdated([memory.id], !outdated)}
          >
            {outdated ? <RotateCcw size={14} /> : <CircleSlash size={14} />}
          </IconButton>
          <IconButton label="Delete" tone="danger" onClick={onDelete}>
            <Trash2 size={14} />
          </IconButton>
        </div>
      </div>
    </li>
  );
}
