import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import {
  parseImport,
  reviewImport,
  type ImportCandidate,
  type ImportIssue,
  type Memory,
  type MemoryService,
} from '../core';
import { Dialog } from '../ui/components/Dialog';
import { Badge, Button, Notice } from '../ui/components/primitives';
import { useToast } from '../ui/components/Toast';
import { cx, plural } from '../ui/format';

interface ImportDialogProps {
  open: boolean;
  library: Memory[];
  service: MemoryService;
  onClose: () => void;
}

const ISSUE_BADGES: Record<Exclude<ImportIssue, 'ok'>, { label: string; tone: 'warn' | 'danger' | 'neutral' }> = {
  duplicate: { label: 'Duplicate', tone: 'neutral' },
  conflict: { label: 'Possible conflict', tone: 'warn' },
  sensitive: { label: 'Looks like a credential', tone: 'danger' },
  invalid: { label: 'Too long', tone: 'danger' },
};

const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Import is always a two-step review: parse, then let the user choose what to
 * add. Nothing in the library is ever replaced by an import.
 */
export function ImportDialog({ open, library, service, onClose }: ImportDialogProps) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pasted, setPasted] = useState('');
  const [error, setError] = useState('');
  const [formatLabel, setFormatLabel] = useState('');
  const [skipped, setSkipped] = useState(0);
  const [candidates, setCandidates] = useState<ImportCandidate[] | null>(null);

  function reset() {
    setPasted('');
    setError('');
    setCandidates(null);
  }

  function close() {
    reset();
    onClose();
  }

  function review(text: string) {
    try {
      const parsed = parseImport(text);
      if (parsed.drafts.length === 0) throw new Error('No memories were found in this file.');
      setFormatLabel(parsed.formatLabel);
      setSkipped(parsed.skipped);
      setCandidates(reviewImport(parsed.drafts, library));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This file could not be read.');
    }
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError('That file is larger than 5 MB.');
      return;
    }
    review(await file.text());
  }

  const selectable = (candidate: ImportCandidate) =>
    candidate.issue !== 'sensitive' && candidate.issue !== 'invalid';
  const chosen = candidates?.filter((c) => c.selected && selectable(c)) ?? [];

  async function runImport() {
    await service.createMany(chosen.map((candidate) => candidate.draft));
    toast(`Imported ${plural(chosen.length, 'memory', 'memories')}`);
    close();
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Import memories"
      width="lg"
      footer={
        candidates ? (
          <>
            <Button className="mr-auto" variant="ghost" onClick={reset}>
              Back
            </Button>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" disabled={chosen.length === 0} onClick={() => void runImport()}>
              Import {plural(chosen.length, 'memory', 'memories')}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" disabled={!pasted.trim()} onClick={() => review(pasted)}>
              Review
            </Button>
          </>
        )
      }
    >
      {!candidates ? (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-ink-2">
            Choose an OmniMemory export, a JSON list, or paste text with one memory per line — for example
            the list a chatbot gives you when you ask it to write out everything it remembers about you.
            You review everything before it is added.
          </p>
          <input
            ref={fileInput}
            type="file"
            accept=".json,.txt,application/json,text/plain"
            className="hidden"
            onChange={(event) => {
              void readFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <Button icon={<Upload size={14} />} onClick={() => fileInput.current?.click()}>
            Choose a file…
          </Button>
          <textarea
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            rows={7}
            aria-label="Paste memories"
            placeholder={'…or paste here, one memory per line:\n- I am a high-school student\n- I prefer concise answers'}
            className="field scroll-thin resize-y font-mono text-xs leading-relaxed"
          />
          {error && <Notice tone="danger">{error}</Notice>}
        </div>
      ) : (
        <div className="space-y-2.5">
          <p className="text-xs text-ink-2">
            {formatLabel} · {plural(candidates.length, 'memory', 'memories')} found
            {skipped > 0 && ` · ${plural(skipped, 'unreadable entry', 'unreadable entries')} skipped`}.
            Duplicates and conflicts are left unticked; tick any you still want as separate memories.
          </p>
          <ul className="scroll-thin max-h-[46vh] overflow-y-auto rounded-md border border-line">
            {candidates.map((candidate) => {
              const badge = candidate.issue === 'ok' ? null : ISSUE_BADGES[candidate.issue];
              const enabled = selectable(candidate);
              return (
                <li key={candidate.key} className="border-b border-line last:border-b-0">
                  <label
                    className={cx(
                      'flex gap-2.5 px-2.5 py-2',
                      enabled ? 'cursor-pointer hover:bg-subtle' : 'opacity-60',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 size-3.5 accent-(--om-accent)"
                      disabled={!enabled}
                      checked={candidate.selected && enabled}
                      onChange={(event) =>
                        setCandidates((list) =>
                          (list ?? []).map((item) =>
                            item.key === candidate.key ? { ...item, selected: event.target.checked } : item,
                          ),
                        )
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] leading-snug">{candidate.draft.content}</span>
                      {badge && (
                        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-3">
                          <Badge tone={badge.tone}>{badge.label}</Badge>
                          {candidate.detail}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Dialog>
  );
}
