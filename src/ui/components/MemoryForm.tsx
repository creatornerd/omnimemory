import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ShieldAlert, TriangleAlert } from 'lucide-react';
import {
  CATEGORIES,
  MAX_CONTENT_LENGTH,
  describeSensitive,
  findSensitive,
  findSimilar,
  type Category,
  type Memory,
  type SiteId,
  type SitePermissions,
} from '../../core';
import { Button, Notice, Select } from './primitives';
import { SiteToggles } from './SiteToggles';
import { cx } from '../format';

export interface MemoryFormValues {
  content: string;
  /** undefined = let OmniMemory pick a category from the text. */
  category?: Category;
  tags: string[];
  enabled: boolean;
  permissions: SitePermissions;
}

interface MemoryFormProps {
  initial?: Partial<MemoryFormValues>;
  /** Sharing defaults for a brand-new memory. */
  defaultPermissions: SitePermissions;
  /** Library to check for duplicates and conflicts against. */
  existing: Memory[];
  /** When editing, the memory being edited (excluded from duplicate checks). */
  editingId?: string;
  submitLabel: string;
  compact?: boolean;
  onSubmit: (values: MemoryFormValues) => Promise<void> | void;
  onCancel: () => void;
  children?: ReactNode;
}

function truncate(text: string, max = 110): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * The one editor for memories: used for new memories, inline edits and
 * reviewing captured text. Warns about duplicates, conflicts and credentials
 * as you type; it never resolves them on its own.
 */
export function MemoryForm({
  initial,
  defaultPermissions,
  existing,
  editingId,
  submitLabel,
  compact,
  onSubmit,
  onCancel,
  children,
}: MemoryFormProps) {
  const [content, setContent] = useState(initial?.content ?? '');
  const [category, setCategory] = useState<Category | ''>(initial?.category ?? '');
  const [tagText, setTagText] = useState((initial?.tags ?? []).join(', '));
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [permissions, setPermissions] = useState<SitePermissions>(
    initial?.permissions ?? defaultPermissions,
  );
  const [allowSensitive, setAllowSensitive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);

  // Focus the text and place the caret at the end.
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // Grow with the content instead of scrolling inside a tiny box.
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 220)}px`;
  }, [content]);

  const trimmed = content.trim();
  const sensitive = useMemo(() => findSensitive(trimmed), [trimmed]);
  const similar = useMemo(
    () => (trimmed.length < 8 ? [] : findSimilar(trimmed, existing, editingId).slice(0, 2)),
    [trimmed, existing, editingId],
  );

  const tooLong = trimmed.length > MAX_CONTENT_LENGTH;
  const blocked = sensitive.length > 0 && !allowSensitive;
  const canSave = trimmed.length > 0 && !tooLong && !blocked && !saving;

  async function submit() {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      await onSubmit({
        content: trimmed,
        category: category || undefined,
        tags: tagText.split(',').map((tag) => tag.trim()).filter(Boolean),
        enabled,
        permissions,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this memory.');
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void submit();
        }
        if (event.key === 'Escape') {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <textarea
        ref={textarea}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        rows={2}
        aria-label="Memory"
        placeholder="Something worth remembering, e.g. “I program VEX robots using PROS and LemLib”"
        className="field scroll-thin resize-none leading-relaxed"
      />

      {tooLong && (
        <p className="text-xs text-danger">
          {trimmed.length} / {MAX_CONTENT_LENGTH} characters — shorten this memory to save it.
        </p>
      )}

      {sensitive.length > 0 && (
        <Notice tone="danger" icon={<ShieldAlert size={14} />}>
          <p>
            {describeSensitive(sensitive)} Memories can be pasted into chatbots, so OmniMemory is not a
            safe place for credentials.
          </p>
          <label className="mt-1.5 flex items-center gap-1.5 font-medium">
            <input
              type="checkbox"
              checked={allowSensitive}
              onChange={(event) => setAllowSensitive(event.target.checked)}
            />
            It isn’t a credential — save it anyway
          </label>
        </Notice>
      )}

      {similar.map((match) => (
        <Notice key={match.memory.id} icon={<TriangleAlert size={14} />}>
          <span className="font-medium">
            {match.kind === 'duplicate' ? 'Possible duplicate.' : 'Possible conflict.'}
          </span>{' '}
          {match.reason}: “{truncate(match.memory.content)}”. Saving keeps both — nothing is overwritten.
        </Notice>
      ))}

      <div className={cx('flex flex-wrap items-center gap-2', compact && 'gap-y-2')}>
        <Select
          aria-label="Category"
          value={category}
          onChange={(event) => setCategory(event.target.value as Category | '')}
        >
          {!editingId && <option value="">Auto category</option>}
          {CATEGORIES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
        {!compact && (
          <input
            value={tagText}
            onChange={(event) => setTagText(event.target.value)}
            aria-label="Tags, separated by commas"
            placeholder="Tags, separated by commas"
            className="field h-7 min-w-0 flex-1 py-0 text-xs"
          />
        )}
        <div className={cx(compact && 'ml-auto')}>
          <SiteToggles
            variant={compact ? 'dots' : 'labels'}
            permissions={permissions}
            enabled={enabled}
            onPermission={(site: SiteId, allowed) => setPermissions((p) => ({ ...p, [site]: allowed }))}
            onEnabled={setEnabled}
          />
        </div>
      </div>

      {children}

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        {!compact && <span className="mr-auto text-[11px] text-ink-3">⌘/Ctrl + Enter to save · Esc to cancel</span>}
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {editingId ? 'Discard' : 'Cancel'}
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={!canSave}>
          {similar.length > 0 && !editingId ? 'Save anyway' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
