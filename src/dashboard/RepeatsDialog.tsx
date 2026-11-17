import { useEffect, useState } from 'react';
import { Check, GitMerge, Loader2, Sparkles } from 'lucide-react';
import type { Memory, RepeatGroup } from '../core';
import { getAssistant } from '../shared/platform';
import { Dialog } from '../ui/components/Dialog';
import { Badge, Button, Notice } from '../ui/components/primitives';
import { useToast } from '../ui/components/Toast';
import { cx, plural, timeAgo } from '../ui/format';
import type { Store } from '../ui/hooks/useStore';

type Outcome = 'merged' | 'ignored';

function newest(memories: Memory[]): Memory {
  return [...memories].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
}

/**
 * "Find repeats": the AI reads the library and lists groups of memories that
 * say the same thing (merge them, with a suggested wording) or contradict
 * each other (keep one). Merging moves the others to Recently Deleted, so
 * it can be undone.
 */
export function RepeatsDialog({ open, store, onClose }: { open: boolean; store: Store; onClose: () => void }) {
  const { service, library, settings } = store;
  const toast = useToast();
  const [groups, setGroups] = useState<RepeatGroup[] | null>(null);
  const [error, setError] = useState('');
  const [texts, setTexts] = useState<Record<number, string>>({});
  const [outcomes, setOutcomes] = useState<Record<number, Outcome>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const assistant = getAssistant(settings);
    setGroups(null);
    setError('');
    setOutcomes({});
    setTexts({});
    if (!assistant) {
      setError('Turn on the AI assistant in Settings first.');
      return;
    }
    let cancelled = false;
    assistant
      .scanLibrary(library)
      .then((found) => !cancelled && setGroups(found))
      .catch((cause: Error) => !cancelled && setError(cause.message));
    return () => {
      cancelled = true;
    };
    // Scan once per opening, on the library as it was then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function merge(index: number, keep: Memory, content: string) {
    const group = groups?.[index];
    if (!group) return;
    const ids = [keep.id, ...group.memories.filter((memory) => memory.id !== keep.id).map((memory) => memory.id)];
    await service.merge(ids, content);
    setOutcomes((current) => ({ ...current, [index]: 'merged' }));
  }

  async function mergeAllRepeats() {
    if (!groups) return;
    setBusy(true);
    let merged = 0;
    try {
      for (const [index, group] of groups.entries()) {
        if (group.kind !== 'duplicate' || outcomes[index]) continue;
        await merge(index, newest(group.memories), texts[index] ?? group.merged ?? newest(group.memories).content);
        merged += 1;
      }
      toast(`Merged ${plural(merged, 'group')} of repeats. The extras are in Recently Deleted.`);
    } catch (cause) {
      toast((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const open_ = groups?.filter((_, index) => !outcomes[index]) ?? [];
  const openRepeats = groups?.filter((group, index) => group.kind === 'duplicate' && !outcomes[index]).length ?? 0;

  return (
    <Dialog open={open} onClose={onClose} title="Find repeats" width="lg">
      {!groups && !error && (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-xs text-ink-3">
          <Loader2 size={18} className="animate-spin" />
          Gemini is reading your {plural(library.filter((memory) => memory.enabled).length, 'memory', 'memories')}…
        </div>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      {groups && groups.length === 0 && (
        <div className="py-12 text-center">
          <Sparkles size={18} className="mx-auto text-ink-3" />
          <p className="mt-2 text-[13px] font-medium">No repeats found</p>
          <p className="mt-1 text-xs text-ink-3">Your memories don’t repeat or contradict each other.</p>
        </div>
      )}
      {groups && groups.length > 0 && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <p className="mr-auto text-xs text-ink-2">
              {open_.length === 0
                ? 'All done.'
                : `${plural(open_.length, 'group')} to look at. Merged extras go to Recently Deleted, so nothing is lost.`}
            </p>
            {openRepeats > 1 && (
              <Button size="sm" variant="primary" icon={<GitMerge size={13} />} disabled={busy} onClick={() => void mergeAllRepeats()}>
                Merge all {openRepeats} repeats
              </Button>
            )}
          </div>
          <ul className="space-y-3">
            {groups.map((group, index) => {
              const outcome = outcomes[index];
              const text = texts[index] ?? group.merged ?? '';
              return (
                <li key={index} className={cx('rounded-lg border border-line p-3', outcome && 'opacity-60')}>
                  <div className="flex items-center gap-2">
                    <Badge tone={group.kind === 'duplicate' ? 'warn' : 'danger'}>
                      {group.kind === 'duplicate' ? 'Repeats' : 'Contradict'}
                    </Badge>
                    <p className="min-w-0 flex-1 truncate text-xs text-ink-2">{group.reason}</p>
                    {outcome && (
                      <span className="flex items-center gap-1 text-xs text-ok">
                        <Check size={12} /> {outcome === 'merged' ? 'Merged' : 'Left as is'}
                      </span>
                    )}
                  </div>
                  <ul className="mt-2 space-y-1">
                    {group.memories.map((memory) => (
                      <li key={memory.id} className="flex items-start gap-2 text-[13px]">
                        <span className="mt-2 size-1 shrink-0 rounded-full bg-ink-3" />
                        <span className="min-w-0 flex-1">{memory.content}</span>
                        <span className="shrink-0 text-[11px] text-ink-3">{timeAgo(memory.updated_at)}</span>
                        {group.kind === 'conflict' && !outcome && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              void merge(index, memory, memory.content)
                                .then(() => toast('Kept that one. The other is in Recently Deleted.'))
                                .catch((cause: Error) => toast(cause.message))
                            }
                          >
                            Keep this
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {!outcome && group.kind === 'duplicate' && (
                    <textarea
                      value={text}
                      onChange={(event) => setTexts((current) => ({ ...current, [index]: event.target.value }))}
                      rows={2}
                      aria-label="Merged wording"
                      className="field mt-2.5 resize-y text-[13px] leading-relaxed"
                    />
                  )}
                  {!outcome && (
                    <div className="mt-2 flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setOutcomes((current) => ({ ...current, [index]: 'ignored' }))}
                      >
                        {group.kind === 'duplicate' ? 'Not repeats' : 'Both are fine'}
                      </Button>
                      {group.kind === 'duplicate' && (
                        <Button
                          size="sm"
                          variant="primary"
                          icon={<GitMerge size={13} />}
                          disabled={busy || !text.trim()}
                          onClick={() =>
                            void merge(index, newest(group.memories), text)
                              .then(() => toast('Merged into one memory'))
                              .catch((cause: Error) => toast(cause.message))
                          }
                        >
                          Merge into one
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Dialog>
  );
}
