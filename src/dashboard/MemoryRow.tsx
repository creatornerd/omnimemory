import { Check, CircleSlash, History, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import type { Memory, MemoryService, Settings } from '../core';
import { sourceLabel } from '../shared/sites';
import { MemoryForm } from '../ui/components/MemoryForm';
import { Badge, IconButton } from '../ui/components/primitives';
import { ShareMenu } from '../ui/components/ShareMenu';
import { useToast } from '../ui/components/Toast';
import { cx, fullDate, timeAgo } from '../ui/format';
import { repeatCheck } from '../ui/hooks/repeat-check';

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
    <details className="rounded-lg border border-line text-xs">
      <summary className="flex items-center gap-1.5 px-3 py-2 text-ink-2 select-none hover:text-ink">
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
      <li className="animate-rise border-b border-line bg-surface p-4 shadow-[inset_0_0_0_1.5px_var(--om-brand)] last:border-b-0">
        <MemoryForm
          editingId={memory.id}
          initial={memory}
          defaultPermissions={settings.defaultPermissions}
          existing={library}
          checkRepeats={repeatCheck(settings, library, memory.id)}
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
        'group flex gap-3.5 border-b border-line py-3.5 pr-3.5 pl-4 transition-colors first:rounded-t-[13px] last:rounded-b-[13px] last:border-b-0',
        compact ? 'items-center py-2' : 'items-start',
        selected ? 'bg-brand-soft' : 'hover:bg-subtle',
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`Select memory: ${memory.content.slice(0, 60)}`}
        onClick={() => onSelect(!selected)}
        className={cx(
          'flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition-colors',
          !compact && 'mt-0.5',
          selected ? 'border-brand bg-brand text-brand-fg' : 'border-line-strong bg-surface hover:border-ink-3',
        )}
      >
        {selected && <Check size={12} strokeWidth={3} />}
      </button>

      <button
        type="button"
        onClick={() => onEdit(true)}
        title="Click to edit"
        className="min-w-0 flex-1 rounded-sm text-left"
      >
        <p
          className={cx(
            'text-sm leading-normal',
            compact ? 'truncate' : 'line-clamp-3 whitespace-pre-line',
            (outdated || !memory.enabled) && 'text-ink-2',
            outdated && 'line-through decoration-ink-3',
          )}
        >
          {memory.content}
        </p>
        {!compact && (
          <p className="mt-[5px] flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
            <Badge>{memory.category}</Badge>
            {outdated && <Badge tone="warn">Outdated</Badge>}
            {!memory.enabled && <Badge>Private</Badge>}
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
        <span className="hidden shrink-0 items-center gap-2 text-xs text-ink-3 md:flex">
          {outdated && <Badge tone="warn">Outdated</Badge>}
          <span className="w-20 truncate">{memory.category}</span>
          <span className="w-14 text-right">{timeAgo(memory.updated_at)}</span>
        </span>
      )}

      <ShareMenu
        permissions={memory.permissions}
        enabled={memory.enabled}
        onPermission={(site, allowed) => void service.update(memory.id, { permissions: { [site]: allowed } })}
        onEnabled={(enabled) => void service.update(memory.id, { enabled })}
        {...(settings.aiEnabled
          ? {
              aiAllowed: memory.aiAllowed,
              onAiAllowed: (allowed: boolean) => void service.update(memory.id, { aiAllowed: allowed }),
            }
          : {})}
      />
      <div className="flex shrink-0 gap-0.5">
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
    </li>
  );
}
