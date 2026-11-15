import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowUpRight, BookmarkPlus, ChevronRight, EyeOff, Pencil, Search, Trash2, X } from 'lucide-react';
import { CONTEXT_FOOTER } from '../../core/context';
import { CATEGORIES, MAX_CONTENT_LENGTH, type Category } from '../../core/types';
import { onChange } from '../../shared/change-bus';
import {
  MAX_PAGE_TEXT_LENGTH,
  type ContextResult,
  type QueryResult,
  type ReviewResult,
  type SharedMemory,
} from '../../shared/messages';
import type { SiteAdapter } from '../adapters';
import { send } from '../bridge';
import { copyText } from '../clipboard';
import { Mark } from './Mark';

interface PanelProps {
  adapter: SiteAdapter;
  style: CSSProperties;
  /** Text the user had selected on the page when the panel opened. */
  selection: string;
  onClearSelection: () => void;
  onClose: () => void;
  /** Close and show a short confirmation next to the launcher. */
  onDone: (message: string) => void;
}

type Status = { tone: 'info' | 'warn'; text: string } | null;

const MAX_PRESELECTED = 6;

function plural(count: number, word: string, pluralWord = `${word}s`): string {
  return `${count} ${count === 1 ? word : pluralWord}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export function Panel({ adapter, style, selection, onClearSelection, onClose, onDone }: PanelProps) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<ContextResult | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState<string | null>(null); // text being reviewed, or null
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preselected = useRef(false);
  const searchInput = useRef<HTMLInputElement>(null);

  // ── Data ───────────────────────────────────────────────────────────────

  const load = useCallback(
    async (text: string) => {
      try {
        const next = await send({
          type: 'context/query',
          query: text.slice(0, 200),
          // Read once, on demand; ranked in the service worker; never stored.
          pageText: adapter.readConversationTail(MAX_PAGE_TEXT_LENGTH),
        });
        setResult(next);
        setError('');
        if (!preselected.current && !text.trim()) {
          preselected.current = true;
          setSelected(
            next.items
              .filter((item) => item.relevant)
              .slice(0, MAX_PRESELECTED)
              .map((item) => item.memory.id),
          );
        }
      } catch (cause) {
        setError(errorText(cause));
      }
    },
    [adapter],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(query), query ? 120 : 0);
    return () => clearTimeout(timer);
  }, [query, revision, load]);

  // Another tab, the popup or the dashboard changed something.
  useEffect(() => onChange(() => setRevision((value) => value + 1)), []);

  // Keep the preview — and the selection itself — in step with what is
  // actually shareable right now. The service worker is the source of truth.
  useEffect(() => {
    if (selected.length === 0) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    send({ type: 'context/build', ids: selected })
      .then((built) => {
        if (cancelled) return;
        setPreview(built);
        if (!built.truncated && built.includedIds.length !== selected.length) {
          setSelected(built.includedIds);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selected, revision]);

  useEffect(() => {
    searchInput.current?.focus();
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────

  function toggle(id: string, on: boolean) {
    setSelected((current) => (on ? [...current.filter((x) => x !== id), id] : current.filter((x) => x !== id)));
  }

  async function freshContext(): Promise<ContextResult | null> {
    const built = await send({ type: 'context/build', ids: selected });
    if (!built.text) {
      setStatus({ tone: 'warn', text: 'Those memories are no longer shared here.' });
      setSelected([]);
      return null;
    }
    return built;
  }

  async function insert() {
    setBusy(true);
    try {
      const built = await freshContext();
      if (!built) return;
      const inserted = await adapter.insert(built.text, CONTEXT_FOOTER);
      if (inserted) {
        void send({ type: 'context/used', ids: built.includedIds }).catch(() => {});
        onDone('Context added to your message — review it before sending.');
        return;
      }
      const copied = await copyText(built.text);
      setShowPreview(true);
      setStatus({
        tone: 'warn',
        text: copied
          ? `Couldn’t type into ${adapter.label}’s message box, so the context was copied instead. Paste it in.`
          : `Couldn’t type into ${adapter.label}’s message box. Select the preview text below and copy it.`,
      });
    } catch (cause) {
      setStatus({ tone: 'warn', text: errorText(cause) });
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    setBusy(true);
    try {
      const built = await freshContext();
      if (!built) return;
      if (await copyText(built.text)) {
        void send({ type: 'context/used', ids: built.includedIds }).catch(() => {});
        setStatus({ tone: 'info', text: 'Context copied. Paste it into your message.' });
      } else {
        setShowPreview(true);
        setStatus({ tone: 'warn', text: 'Copying was blocked. Select the preview text below and copy it.' });
      }
    } catch (cause) {
      setStatus({ tone: 'warn', text: errorText(cause) });
    } finally {
      setBusy(false);
    }
  }

  async function act(run: () => Promise<unknown>, done: string) {
    try {
      await run();
      setStatus({ tone: 'info', text: done });
      setRevision((value) => value + 1);
    } catch (cause) {
      setStatus({ tone: 'warn', text: errorText(cause) });
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  const items = result?.items ?? [];
  const suggested = query.trim() ? [] : items.filter((item) => item.relevant);
  const others = query.trim() ? items : items.filter((item) => !item.relevant);

  const row = (memory: SharedMemory) => {
    if (editingId === memory.id) {
      return (
        <li key={memory.id}>
          <EditRow
            memory={memory}
            onCancel={() => setEditingId(null)}
            onSave={(content) =>
              act(async () => {
                await send({ type: 'memory/update', id: memory.id, content });
                setEditingId(null);
              }, 'Memory updated everywhere.')
            }
          />
        </li>
      );
    }
    if (deletingId === memory.id) {
      return (
        <li key={memory.id} className="om-inline" data-tone="danger">
          <p>Delete this memory from OmniMemory? You can restore it for 30 days from the manager.</p>
          <div className="om-actions" style={{ marginTop: 0 }}>
            <button className="om-btn" data-variant="ghost" onClick={() => setDeletingId(null)}>
              Cancel
            </button>
            <button
              className="om-btn"
              data-variant="danger"
              autoFocus
              onClick={() =>
                void act(async () => {
                  await send({ type: 'memory/delete', id: memory.id });
                  setDeletingId(null);
                }, 'Moved to Recently Deleted.')
              }
            >
              Delete
            </button>
          </div>
        </li>
      );
    }
    const checked = selected.includes(memory.id);
    const inputId = `om-${memory.id}`;
    return (
      <li key={memory.id} className="om-row">
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          onChange={(event) => toggle(memory.id, event.target.checked)}
        />
        <label htmlFor={inputId} className="om-row-text">
          <div className="om-row-content">{memory.content}</div>
          <div className="om-row-meta">{memory.category}</div>
        </label>
        <div className="om-row-actions">
          <button className="om-icon-btn" title="Edit" aria-label="Edit memory" onClick={() => setEditingId(memory.id)}>
            <Pencil size={13} />
          </button>
          <button
            className="om-icon-btn"
            title={`Stop sharing with ${adapter.label}`}
            aria-label={`Stop sharing this memory with ${adapter.label}`}
            onClick={() =>
              void act(
                () => send({ type: 'memory/unshare', id: memory.id }),
                `No longer shared with ${adapter.label}. Turn it back on in the manager.`,
              )
            }
          >
            <EyeOff size={13} />
          </button>
          <button
            className="om-icon-btn"
            data-tone="danger"
            title="Delete"
            aria-label="Delete memory"
            onClick={() => setDeletingId(memory.id)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </li>
    );
  };

  const blockedMessage =
    result?.blocked === 'global-pause'
      ? 'Sharing is paused everywhere.'
      : result?.blocked === 'site-pause'
        ? `Sharing with ${adapter.label} is paused.`
        : '';

  return (
    <div
      className="om-panel"
      role="dialog"
      aria-label="OmniMemory"
      style={style}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (saving !== null) setSaving(null);
          else if (editingId || deletingId) {
            setEditingId(null);
            setDeletingId(null);
          } else onClose();
        }
      }}
    >
      <div className="om-header">
        <Mark size={18} />
        <div className="om-title">
          OmniMemory <span>· {adapter.label}</span>
        </div>
        <button
          className="om-icon-btn"
          title="Open the memory manager"
          aria-label="Open the memory manager"
          onClick={() => void send({ type: 'ui/open-dashboard', view: 'library' }).catch(() => {})}
        >
          <ArrowUpRight size={15} />
        </button>
        <button className="om-icon-btn" title="Close (Esc)" aria-label="Close" onClick={onClose}>
          <X size={15} />
        </button>
      </div>

      {saving !== null ? (
        <SaveForm
          initial={saving}
          siteLabel={adapter.label}
          onCancel={() => setSaving(null)}
          onSaved={() => {
            setSaving(null);
            onClearSelection();
            setStatus({ tone: 'info', text: 'Memory saved.' });
            setRevision((value) => value + 1);
          }}
        />
      ) : (
        <>
          <div className="om-search">
            <Search size={14} />
            <input
              ref={searchInput}
              className="om-field"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search your memories"
              aria-label="Search your memories"
            />
          </div>

          <div className="om-body">
            {selection && (
              <div className="om-selection">
                <span title={selection}>Selected: “{selection}”</span>
                <button className="om-btn" onClick={() => setSaving(selection.slice(0, MAX_CONTENT_LENGTH))}>
                  Save as memory…
                </button>
              </div>
            )}

            {error ? (
              <div className="om-empty">
                <strong>OmniMemory isn’t available</strong>
                {error}
              </div>
            ) : !result ? (
              <div className="om-empty">Loading…</div>
            ) : blockedMessage ? (
              <div className="om-empty">
                <strong>{blockedMessage}</strong>
                Nothing can be retrieved here until you resume it from the OmniMemory toolbar button.
              </div>
            ) : result.total === 0 ? (
              <div className="om-empty">
                <strong>No memories shared with {adapter.label} yet</strong>
                Save one below, or turn on sharing for existing memories in the manager.
              </div>
            ) : items.length === 0 ? (
              <div className="om-empty">No shared memories match “{query}”.</div>
            ) : (
              <>
                {suggested.length > 0 && (
                  <>
                    <div className="om-section">Suggested for this chat</div>
                    <ul className="om-list">{suggested.map((item) => row(item.memory))}</ul>
                  </>
                )}
                {others.length > 0 && (
                  <>
                    <div className="om-section">
                      {query.trim()
                        ? plural(others.length, 'result')
                        : suggested.length > 0
                          ? 'Other memories'
                          : `Shared with ${adapter.label}`}
                    </div>
                    <ul className="om-list">{others.map((item) => row(item.memory))}</ul>
                  </>
                )}
              </>
            )}
          </div>

          <div className="om-footer">
            {status && (
              <p className="om-status" data-tone={status.tone} role="status">
                {status.text}
              </p>
            )}
            {preview && preview.text && (
              <>
                <button
                  className="om-preview-toggle"
                  aria-expanded={showPreview}
                  onClick={() => setShowPreview((value) => !value)}
                >
                  <ChevronRight size={13} />
                  Preview what {adapter.label} will receive ·{' '}
                  {plural(preview.includedIds.length, 'memory', 'memories')}
                  {preview.truncated && ' (some left out — too long)'}
                </button>
                {showPreview && (
                  <pre className="om-preview" tabIndex={0}>
                    {preview.text}
                  </pre>
                )}
              </>
            )}
            <div className="om-actions" style={{ marginTop: 0 }}>
              <button className="om-btn om-grow" data-variant="ghost" onClick={() => setSaving('')}>
                <BookmarkPlus size={13} />
                Save a memory
              </button>
              <button className="om-btn" disabled={selected.length === 0 || busy} onClick={() => void copy()}>
                Copy
              </button>
              <button
                className="om-btn"
                data-variant="primary"
                disabled={selected.length === 0 || busy}
                onClick={() => void insert()}
              >
                Insert context{selected.length > 0 ? ` (${selected.length})` : ''}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Inline edit ──────────────────────────────────────────────────────────

function EditRow({
  memory,
  onSave,
  onCancel,
}: {
  memory: SharedMemory;
  onSave: (content: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [content, setContent] = useState(memory.content);
  const changed = content.trim() !== memory.content && content.trim().length > 0;
  return (
    <div className="om-inline">
      <textarea
        className="om-field"
        autoFocus
        aria-label="Edit memory"
        value={content}
        maxLength={MAX_CONTENT_LENGTH}
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && changed) void onSave(content.trim());
        }}
      />
      <div className="om-actions">
        <button className="om-btn" data-variant="ghost" onClick={onCancel}>
          Discard
        </button>
        <button className="om-btn" data-variant="primary" disabled={!changed} onClick={() => void onSave(content.trim())}>
          Save
        </button>
      </div>
    </div>
  );
}

// ── Save a new memory (always reviewed first) ────────────────────────────

function SaveForm({
  initial,
  siteLabel,
  onSaved,
  onCancel,
}: {
  initial: string;
  siteLabel: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [content, setContent] = useState(initial);
  const [category, setCategory] = useState<Category | ''>('');
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const trimmed = content.trim();

  // Ask the service worker about duplicates, conflicts and credentials.
  useEffect(() => {
    if (trimmed.length < 4) {
      setReview(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      send({ type: 'memory/review', content: trimmed })
        .then((next) => !cancelled && setReview(next))
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed]);

  const blocked = useMemo(() => !!review?.sensitive, [review]);

  async function save() {
    setSaving(true);
    setError('');
    try {
      await send({ type: 'memory/create', content: trimmed, category: category || undefined, tags: [] });
      onSaved();
    } catch (cause) {
      setError(errorText(cause));
      setSaving(false);
    }
  }

  return (
    <div className="om-body" style={{ padding: '10px 12px 12px' }}>
      <div className="om-section" style={{ padding: '0 0 6px' }}>
        {initial ? 'Review before saving' : 'New memory'}
      </div>
      <textarea
        className="om-field"
        autoFocus
        aria-label="Memory"
        placeholder="A fact worth remembering across chatbots"
        value={content}
        maxLength={MAX_CONTENT_LENGTH}
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && trimmed && !blocked) void save();
        }}
      />

      {review?.sensitive && (
        <div className="om-notice" data-tone="danger" role="alert">
          {review.sensitive} OmniMemory doesn’t store credentials — remove it to save.
        </div>
      )}
      {review?.similar.map((match, index) => (
        <div className="om-notice" key={index} role="alert">
          <strong>{match.kind === 'duplicate' ? 'Possible duplicate. ' : 'Possible conflict. '}</strong>
          {match.reason}: “{match.content.length > 90 ? `${match.content.slice(0, 89)}…` : match.content}”. Saving
          keeps both.
        </div>
      ))}
      {error && (
        <div className="om-notice" data-tone="danger" role="alert">
          {error}
        </div>
      )}

      <div className="om-actions">
        <select
          className="om-field om-grow"
          aria-label="Category"
          value={category}
          onChange={(event) => setCategory(event.target.value as Category | '')}
        >
          <option value="">
            {review ? `Auto · ${review.suggestedCategory}` : 'Auto category'}
          </option>
          {CATEGORIES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <button className="om-btn" data-variant="ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="om-btn" data-variant="primary" disabled={!trimmed || blocked || saving} onClick={() => void save()}>
          {review?.similar.length ? 'Save anyway' : 'Save memory'}
        </button>
      </div>
      <div className="om-notice" data-tone="info">
        Saved on this device and marked as coming from {siteLabel}. It follows your default sharing
        settings; change them per memory in the manager.
      </div>
    </div>
  );
}
