import { useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { TRASH_RETENTION_DAYS, type Memory } from '../core';
import { ConfirmDialog } from '../ui/components/Dialog';
import { Badge, Button, Notice } from '../ui/components/primitives';
import { useToast } from '../ui/components/Toast';
import { daysLeftInTrash, plural, shortDate } from '../ui/format';
import type { Store } from '../ui/hooks/useStore';
import { Help } from './help';

export function Trash({ store }: { store: Store }) {
  const { service, trash, loading } = store;
  const toast = useToast();
  const [purging, setPurging] = useState<Memory | null>(null);
  const [emptying, setEmptying] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-[900px] flex-wrap items-start gap-3 px-10 pt-8 pb-4 max-md:px-5">
        <div className="mr-auto">
          <h1 className="flex items-center gap-1.5 text-[22px] font-semibold tracking-[-0.02em]">
            Recently deleted <Help id="trash.page" />
          </h1>
          <p className="mt-1.5 text-[13.5px] text-ink-2">
            Deleted memories wait here for {TRASH_RETENTION_DAYS} days. Restoring one brings back its sharing settings too.
          </p>
        </div>
        <Button
          disabled={trash.length === 0}
          icon={<RotateCcw size={14} />}
          onClick={() =>
            void service.restore(trash.map((m) => m.id)).then(() => toast('Restored everything'))
          }
        >
          Restore all
        </Button>
        <Button variant="dangerOutline" disabled={trash.length === 0} onClick={() => setEmptying(true)}>
          Empty trash
        </Button>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[900px] px-10 pb-16 max-md:px-5">
          <Notice tone="info">
            Deleted memories are never shared with any chatbot. When chatbot memory sync is on, deleting a
            memory also removes it from those chatbots’ memory, and restoring it puts it back. ChatGPT’s own
            AI-written memory summary isn’t changed by OmniMemory.
          </Notice>

        <div className="mt-4 overflow-hidden rounded-[14px] border border-line bg-surface">
        {!loading && trash.length === 0 && (
          <p className="px-6 py-12 text-center text-[13.5px] text-ink-3">Nothing here. Deleted memories show up in this list.</p>
        )}

        <ul className="divide-y divide-line">
          {trash.map((memory) => {
            const daysLeft = daysLeftInTrash(memory.deleted_at);
            return (
              <li key={memory.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                <div className="min-w-[220px] flex-1">
                  <p className="line-clamp-3 text-sm leading-normal text-ink-2">{memory.content}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                    <Badge>{memory.category}</Badge>
                    {memory.deleted_at && <span>Deleted {shortDate(memory.deleted_at)}</span>}
                    <span aria-hidden>·</span>
                    <span className={daysLeft <= 3 ? 'text-danger' : undefined}>
                      {daysLeft === 0 ? 'Erased today' : `${plural(daysLeft, 'day')} left`}
                    </span>
                  </p>
                </div>
                <Button
                  size="sm"
                  icon={<RotateCcw size={13} />}
                  onClick={() => void service.restore([memory.id]).then(() => toast('Memory restored'))}
                >
                  Restore
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger hover:bg-danger-soft hover:text-danger"
                  icon={<Trash2 size={13} />}
                  onClick={() => setPurging(memory)}
                >
                  Delete forever
                </Button>
              </li>
            );
          })}
        </ul>
        </div>
        </div>
      </div>

      <ConfirmDialog
        open={purging !== null}
        title="Delete forever?"
        confirmLabel="Delete forever"
        danger
        onCancel={() => setPurging(null)}
        onConfirm={() => {
          if (!purging) return;
          void service.purge([purging.id]).then(() => {
            setPurging(null);
            toast('Permanently deleted');
          });
        }}
      >
        {purging && <p className="rounded-md bg-subtle px-2.5 py-2 text-ink">“{purging.content}”</p>}
        <p>This erases the memory and its history from this device. It cannot be undone.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={emptying}
        title="Empty Recently Deleted?"
        confirmLabel={`Erase ${plural(trash.length, 'memory', 'memories')}`}
        danger
        onCancel={() => setEmptying(false)}
        onConfirm={() =>
          void service.emptyTrash().then((count) => {
            setEmptying(false);
            toast(`Permanently deleted ${plural(count, 'memory', 'memories')}`);
          })
        }
      >
        <p>
          All {plural(trash.length, 'memory', 'memories')} in Recently Deleted will be permanently erased
          from this device. This cannot be undone.
        </p>
      </ConfirmDialog>
    </div>
  );
}
