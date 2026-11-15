import { useEffect, useState } from 'react';
import type { Memory, MemoryService } from '../core';
import { Dialog } from '../ui/components/Dialog';
import { Button, Notice } from '../ui/components/primitives';
import { useToast } from '../ui/components/Toast';
import { cx, timeAgo } from '../ui/format';

interface MergeDialogProps {
  memories: Memory[] | null;
  service: MemoryService;
  onClose: (merged: boolean) => void;
}

/**
 * Combine several memories into one. The user picks (and can rewrite) the
 * final text; the others go to Recently Deleted so the merge is reversible.
 */
export function MergeDialog({ memories, service, onClose }: MergeDialogProps) {
  const toast = useToast();
  const [keepId, setKeepId] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!memories || memories.length === 0) return;
    // Default to the most recently updated wording.
    const newest = [...memories].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
    setKeepId(newest.id);
    setContent(newest.content);
    setError('');
  }, [memories]);

  if (!memories) return null;

  async function merge() {
    if (!memories) return;
    try {
      const ordered = [keepId, ...memories.map((m) => m.id).filter((id) => id !== keepId)];
      await service.merge(ordered, content);
      toast(`Merged ${memories.length} memories into one`);
      onClose(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not merge these memories.');
    }
  }

  return (
    <Dialog
      open
      onClose={() => onClose(false)}
      title={`Merge ${memories.length} memories`}
      footer={
        <>
          <Button onClick={() => onClose(false)}>Cancel</Button>
          <Button variant="primary" disabled={!content.trim()} onClick={() => void merge()}>
            Merge into one
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <fieldset className="space-y-1.5">
          <legend className="mb-1.5 text-xs text-ink-2">Start from the wording you want to keep:</legend>
          {memories.map((memory) => (
            <label
              key={memory.id}
              className={cx(
                'flex cursor-pointer gap-2.5 rounded-md border px-2.5 py-2 transition-colors',
                keepId === memory.id ? 'border-ink-3 bg-subtle' : 'border-line hover:bg-subtle',
              )}
            >
              <input
                type="radio"
                name="keep"
                className="mt-1 accent-(--om-accent)"
                checked={keepId === memory.id}
                onChange={() => {
                  setKeepId(memory.id);
                  setContent(memory.content);
                }}
              />
              <span className="min-w-0">
                <span className="block text-[13px] leading-snug">{memory.content}</span>
                <span className="text-[11px] text-ink-3">
                  {memory.category} · updated {timeAgo(memory.updated_at)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <label className="block space-y-1.5">
          <span className="text-xs text-ink-2">Merged memory</span>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={3}
            className="field scroll-thin resize-y leading-relaxed"
          />
        </label>

        <Notice tone="info">
          The other {memories.length - 1 === 1 ? 'memory moves' : `${memories.length - 1} memories move`} to
          Recently Deleted, where you can restore {memories.length - 1 === 1 ? 'it' : 'them'} for 30 days.
          The merged memory is shared only with chatbots that every original was shared with.
        </Notice>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}
