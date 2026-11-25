import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowUpRight,
  BookmarkPlus,
  ChevronRight,
  Copy,
  EyeOff,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { CONTEXT_FOOTER } from '../../core/context';
import {
  CATEGORIES,
  MAX_CONTENT_LENGTH,
  SITE_IDS,
  isSiteId,
  type Category,
  type SiteId,
  type SitePermissions,
} from '../../core/types';
import { onChange } from '../../shared/change-bus';
import {
  MAX_CONVERSATION_TEXT,
  MAX_PAGE_TEXT_LENGTH,
  type ContextResult,
  type QueryResult,
  type ReviewResult,
  type SharedMemory,
  type SuggestResult,
} from '../../shared/messages';
import { SITES } from '../../shared/sites';
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

/** A memory just hidden or deleted here, kept in its place with an Undo. */
interface Ghost {
  memory: SharedMemory;
  relevant: boolean;
  index: number;
  kind: 'hide' | 'delete';
}

/**
 * What was typed in "New memory" and not saved yet. Kept for as long as the
 * page is open, so Escape or closing the panel never throws it away.
 */
const draft = { text: '', category: '' as Category | '' };

function plural(count: number, word: string, pluralWord = `${word}s`): string {
  return `${count} ${count === 1 ? word : pluralWord}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

const flat = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** Memories already written into the message box (by an earlier "Add"). */
function inMessage(adapter: SiteAdapter, memories: SharedMemory[]): Set<string> {
  const text = flat(adapter.readDraft());
  if (!text) return new Set();
  return new Set(memories.filter((memory) => text.includes(flat(memory.content))).map((memory) => memory.id));
}

export function Panel({ adapter, style, selection, onClearSelection, onClose, onDone }: PanelProps) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [already, setAlready] = useState<Set<string>>(new Set());
  const [ghosts, setGhosts] = useState<Map<string, Ghost>>(new Map());
  const [preview, setPreview] = useState<ContextResult | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState<string | null>(null); // text being reviewed, or null
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
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
        setAlready(inMessage(adapter, next.items.map((item) => item.memory)));
        setError('');
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

  // Messages go away on their own; warnings stay a little longer.
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(null), status.tone === 'warn' ? 7000 : 3500);
    return () => clearTimeout(timer);
  }, [status]);

  // ── Actions ────────────────────────────────────────────────────────────

  function toggle(id: string, on: boolean) {
    setSelected((current) => (on ? [...current.filter((x) => x !== id), id] : current.filter((x) => x !== id)));
  }

  /** Context for the ticked memories, leaving out any already in the message. */
  async function freshContext(): Promise<ContextResult | null> {
    const memories = result?.items.map((item) => item.memory) ?? [];
    const present = inMessage(adapter, memories.filter((memory) => selected.includes(memory.id)));
    const ids = selected.filter((id) => !present.has(id));
    if (ids.length === 0) {
      setStatus({ tone: 'warn', text: 'Those memories are already in your message.' });
      setSelected([]);
      setAlready((current) => new Set([...current, ...present]));
      return null;
    }
    const built = await send({ type: 'context/build', ids });
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
        onDone(`Added ${plural(built.includedIds.length, 'memory', 'memories')}. Check it before sending.`);
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

  /** Hide (stop sharing here) or delete, leaving an Undo where the row was. */
  async function remove(memory: SharedMemory, relevant: boolean, index: number, kind: Ghost['kind']) {
    try {
      await send({ type: kind === 'hide' ? 'memory/unshare' : 'memory/delete', id: memory.id });
      setSelected((current) => current.filter((id) => id !== memory.id));
      setGhosts((current) => new Map(current).set(memory.id, { memory, relevant, index, kind }));
    } catch (cause) {
      setStatus({ tone: 'warn', text: errorText(cause) });
    }
  }

  async function undo(id: string) {
    try {
      await send({ type: 'memory/undo', id });
      setGhosts((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
      setRevision((value) => value + 1);
    } catch (cause) {
      setStatus({ tone: 'warn', text: errorText(cause) });
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  const searching = query.trim().length > 0;
  // Rows just hidden or deleted stay where they were, so nothing shifts under the cursor.
  const items: { memory: SharedMemory; relevant: boolean; ghost?: Ghost }[] = (result?.items ?? []).filter(
    (item) => !ghosts.has(item.memory.id),
  );
  if (!searching) {
    for (const ghost of [...ghosts.values()].sort((a, b) => a.index - b.index)) {
      items.splice(Math.min(ghost.index, items.length), 0, { memory: ghost.memory, relevant: ghost.relevant, ghost });
    }
  }
  const suggested = searching ? [] : items.filter((item) => item.relevant);
  const others = searching ? items : items.filter((item) => !item.relevant);
  const tickable = suggested.filter((item) => !item.ghost && !already.has(item.memory.id)).map((item) => item.memory.id);
  const allTicked = tickable.length > 0 && tickable.every((id) => selected.includes(id));

  const row = (item: (typeof items)[number], index: number) => {
    const { memory, ghost } = item;
    if (ghost) {
      return (
        <li key={memory.id} className="om-row om-ghost">
          <span className="om-grow">
            {ghost.kind === 'hide' ? `Hidden from ${adapter.label}.` : 'Moved to Recently deleted.'}
          </span>
          <button className="om-link" onClick={() => void undo(memory.id)}>
            Undo
          </button>
        </li>
      );
    }
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
    const inside = already.has(memory.id);
    const checked = selected.includes(memory.id);
    const inputId = `om-${memory.id}`;
    const from = isSiteId(memory.source) && memory.source !== adapter.id ? SITES[memory.source].label : null;
    return (
      <li key={memory.id} className="om-row" data-inside={inside || undefined}>
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          disabled={inside}
          title={inside ? 'Already in your message' : undefined}
          onChange={(event) => toggle(memory.id, event.target.checked)}
        />
        <label htmlFor={inputId} className="om-row-text" title={memory.category}>
          <div className="om-row-content">{memory.content}</div>
          {(inside || from) && (
            <div className="om-row-meta">
              {inside ? 'Already in your message' : `Saved on ${from}`}
              {inside && from ? ` · Saved on ${from}` : ''}
            </div>
          )}
        </label>
        <div className="om-row-actions">
          <button className="om-icon-btn" title="Edit" aria-label="Edit memory" onClick={() => setEditingId(memory.id)}>
            <Pencil size={13} />
          </button>
          <button
            className="om-icon-btn"
            title={`Hide from ${adapter.label} (keeps it for the others)`}
            aria-label={`Hide this memory from ${adapter.label}`}
            onClick={() => void remove(memory, item.relevant, index, 'hide')}
          >
            <EyeOff size={13} />
          </button>
          <button
            className="om-icon-btn"
            title="Delete (you can undo, or restore it from Recently deleted)"
            aria-label="Delete memory"
            onClick={() => void remove(memory, item.relevant, index, 'delete')}
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

  const openNew = () => setSaving(draft.text);

  return (
    <div
      className="om-panel"
      role="dialog"
      aria-label="OmniMemory"
      style={style}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        // Escape on an open dropdown only closes the dropdown.
        if ((event.target as HTMLElement).tagName === 'SELECT') return;
        if (saving !== null) setSaving(null);
        else if (editingId) setEditingId(null);
        else if (suggesting) setSuggesting(false);
        else onClose();
      }}
    >
      <div className="om-header">
        <Mark size={18} />
        <div className="om-title">
          OmniMemory{' '}
          <span className="om-site">
            <i style={result?.color && /^#[0-9a-f]{6}$/i.test(result.color) ? { background: result.color } : undefined} />
            {adapter.label}
          </span>
        </div>
        {saving === null && !suggesting && result?.ai && (
          <button
            className="om-icon-btn"
            title="Suggest memories from this chat (uses AI)"
            aria-label="Suggest memories from this chat"
            onClick={() => setSuggesting(true)}
          >
            <Sparkles size={15} />
          </button>
        )}
        {saving === null && !suggesting && (
          <button className="om-icon-btn" title="Save a new memory" aria-label="Save a new memory" onClick={openNew}>
            <Plus size={15} />
          </button>
        )}
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

      {suggesting ? (
        <SuggestFromChat
          adapter={adapter}
          onClose={(saved) => {
            setSuggesting(false);
            if (saved > 0) {
              setStatus({ tone: 'info', text: `Saved ${plural(saved, 'memory', 'memories')}.` });
              setRevision((value) => value + 1);
            }
          }}
        />
      ) : saving !== null && result ? (
        <SaveForm
          initial={saving}
          restored={saving !== '' && saving === draft.text}
          siteId={adapter.id}
          shareDefaults={result.shareDefaults}
          onCancel={() => setSaving(null)}
          onSaved={(shared) => {
            setSaving(null);
            onClearSelection();
            setStatus({
              tone: 'info',
              text: shared ? 'Memory saved.' : `Memory saved. It isn’t shared with ${adapter.label}, so it won’t show here.`,
            });
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
                <span title={selection}>“{selection}”</span>
                <button className="om-btn" onClick={() => setSaving(selection.slice(0, MAX_CONTENT_LENGTH))}>
                  <BookmarkPlus size={13} /> Save
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
            ) : result.total === 0 && ghosts.size === 0 ? (
              <div className="om-empty">
                <strong>No memories shared with {adapter.label} yet</strong>
                Press + to save one.
                {!result.syncOn && (
                  <>
                    {' '}
                    To bring in what {adapter.label} already remembers, turn on sync for it in the manager.
                    <button
                      className="om-btn"
                      style={{ marginTop: 10 }}
                      onClick={() => void send({ type: 'ui/open-dashboard', view: 'chatbots' }).catch(() => {})}
                    >
                      <RefreshCw size={13} /> Set up sync
                    </button>
                  </>
                )}
              </div>
            ) : items.length === 0 ? (
              <div className="om-empty">No memories match “{query}”.</div>
            ) : (
              <>
                {suggested.length > 0 && (
                  <>
                    <div className="om-section om-section-row">
                      <span className="om-grow">Suggested for this chat</span>
                      {tickable.length > 1 && (
                        <button
                          className="om-link"
                          onClick={() =>
                            setSelected((current) =>
                              allTicked
                                ? current.filter((id) => !tickable.includes(id))
                                : [...new Set([...current, ...tickable])],
                            )
                          }
                        >
                          {allTicked ? 'Untick all' : `Tick all ${tickable.length}`}
                        </button>
                      )}
                    </div>
                    <ul className="om-list">{suggested.map((item) => row(item, items.indexOf(item)))}</ul>
                  </>
                )}
                {others.length > 0 && (
                  <>
                    <div className="om-section">
                      {searching
                        ? plural(others.length, 'result')
                        : suggested.length > 0
                          ? 'Everything else'
                          : 'Your memories'}
                    </div>
                    <ul className="om-list">{others.map((item) => row(item, items.indexOf(item)))}</ul>
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
            {showPreview && preview?.text && (
              <pre className="om-preview" tabIndex={0}>
                {preview.text}
              </pre>
            )}
            <div className="om-actions" style={{ marginTop: 0 }}>
              {preview?.text ? (
                <button
                  className="om-preview-toggle om-grow"
                  aria-expanded={showPreview}
                  title={`What ${adapter.label} will receive`}
                  onClick={() => setShowPreview((value) => !value)}
                >
                  <ChevronRight size={13} />
                  Preview{preview.truncated ? ' (shortened)' : ''}
                </button>
              ) : (
                <span className="om-hint om-grow">{selected.length === 0 ? 'Tick memories to add them' : ''}</span>
              )}
              <button
                className="om-btn"
                title="Copy instead"
                aria-label="Copy context"
                disabled={selected.length === 0 || busy}
                onClick={() => void copy()}
              >
                <Copy size={13} />
                Copy
              </button>
              <button
                className="om-btn"
                data-variant="primary"
                disabled={selected.length === 0 || busy}
                onClick={() => void insert()}
              >
                {selected.length > 0 ? `Add ${selected.length} to message` : 'Add to message'}
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

// ── Suggest memories from the chat (AI, only when asked) ─────────────────

function SuggestFromChat({ adapter, onClose }: { adapter: SiteAdapter; onClose: (saved: number) => void }) {
  const [state, setState] = useState<{ result?: SuggestResult; error?: string }>({});
  const [off, setOff] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    send({ type: 'ai/suggest', conversation: adapter.readConversationTail(MAX_CONVERSATION_TEXT) })
      .then((result) => !cancelled && setState({ result }))
      .catch((cause) => !cancelled && setState({ error: errorText(cause) }));
    return () => {
      cancelled = true;
    };
  }, [adapter]);

  const suggestions = state.result?.suggestions ?? [];
  const chosen = suggestions.filter((_, index) => !off.includes(index));

  async function save() {
    setSaving(true);
    let saved = 0;
    for (const suggestion of chosen) {
      try {
        await send({ type: 'memory/create', content: suggestion.text, category: suggestion.category, tags: [] });
        saved += 1;
      } catch {
        // skip one that was refused (a repeat, say); save the rest
      }
    }
    onClose(saved);
  }

  return (
    <>
      <div className="om-body">
        <div className="om-section">From this chat</div>
        {!state.result && !state.error && (
          <div className="om-empty">
            <strong>Reading this chat…</strong>
            The visible conversation is sent to Gemini to find lasting facts about you.
          </div>
        )}
        {state.error && <div className="om-empty">{state.error}</div>}
        {state.result && suggestions.length === 0 && (
          <div className="om-empty">
            <strong>Nothing new to remember</strong>
            {state.result.alreadyHave > 0 ? 'Your memories already cover what’s in this chat.' : 'No lasting facts about you here.'}
          </div>
        )}
        {suggestions.length > 0 && (
          <ul className="om-list">
            {suggestions.map((suggestion, index) => (
              <li key={index} className="om-row">
                <input
                  id={`om-suggest-${index}`}
                  type="checkbox"
                  checked={!off.includes(index)}
                  onChange={() =>
                    setOff((current) => (current.includes(index) ? current.filter((i) => i !== index) : [...current, index]))
                  }
                />
                <label htmlFor={`om-suggest-${index}`} className="om-row-text">
                  <div className="om-row-content">{suggestion.text}</div>
                  <div className="om-row-meta">{suggestion.category}</div>
                </label>
              </li>
            ))}
          </ul>
        )}
        {state.result && state.result.alreadyHave > 0 && suggestions.length > 0 && (
          <p className="om-hint" style={{ padding: '6px 16px' }}>
            {plural(state.result.alreadyHave, 'fact')} you already have {state.result.alreadyHave === 1 ? 'was' : 'were'} left out.
          </p>
        )}
      </div>
      <div className="om-footer">
        <div className="om-actions" style={{ marginTop: 0 }}>
          <button className="om-btn om-grow" data-variant="ghost" onClick={() => onClose(0)}>
            Back
          </button>
          {suggestions.length > 0 && (
            <button className="om-btn" data-variant="primary" disabled={saving || chosen.length === 0} onClick={() => void save()}>
              Save {chosen.length}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// ── Save a new memory (always reviewed first) ────────────────────────────

function SaveForm({
  initial,
  restored,
  siteId,
  shareDefaults,
  onSaved,
  onCancel,
}: {
  initial: string;
  /** The text is an unsaved draft from earlier. */
  restored: boolean;
  siteId: SiteId;
  shareDefaults: SitePermissions;
  /** `shared`: the new memory is shared with this chatbot. */
  onSaved: (shared: boolean) => void;
  onCancel: () => void;
}) {
  const [content, setContent] = useState(initial);
  const [category, setCategory] = useState<Category | ''>(restored ? draft.category : '');
  const [share, setShare] = useState<SitePermissions>(shareDefaults);
  const [review, setReview] = useState<{ text: string; result: ReviewResult } | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const trimmed = content.trim();
  const current = review?.text === trimmed ? review.result : null;

  // Keep what's typed if the form is closed without saving.
  useEffect(() => {
    draft.text = content;
    draft.category = category;
  }, [content, category]);

  // Ask the service worker about duplicates, conflicts and credentials.
  useEffect(() => {
    if (trimmed.length < 4) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      send({ type: 'memory/review', content: trimmed })
        .then((next) => !cancelled && setReview({ text: trimmed, result: next }))
        .catch(() => {});
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed]);

  const identical = current?.similar.some((match) => match.reason === 'Identical wording') ?? false;
  const blocked = !!current?.sensitive || identical;
  const sharedWith = SITE_IDS.filter((site) => share[site]);

  async function save() {
    setSaving(true);
    setError('');
    try {
      // Never save before the repeat check has had its say: if it hasn't
      // answered for this exact text yet, ask now and show what it finds.
      if (!current && trimmed.length >= 4) {
        const result = await send({ type: 'memory/review', content: trimmed });
        setReview({ text: trimmed, result });
        if (result.sensitive || result.similar.length > 0) {
          setSaving(false);
          return;
        }
      }
      await send({ type: 'memory/create', content: trimmed, category: category || undefined, tags: [], permissions: share });
      draft.text = '';
      draft.category = '';
      onSaved(share[siteId] === true);
    } catch (cause) {
      setError(errorText(cause));
      setSaving(false);
    }
  }

  return (
    <div className="om-body" style={{ padding: '10px 12px 12px' }}>
      <div className="om-section" style={{ padding: '0 0 6px' }}>
        {restored ? 'New memory (your unsaved draft)' : initial ? 'Review before saving' : 'New memory'}
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

      {current?.sensitive && (
        <div className="om-notice" data-tone="danger" role="alert">
          {current.sensitive} OmniMemory doesn’t store credentials — remove it to save.
        </div>
      )}
      {identical ? (
        <div className="om-notice" role="alert">
          <strong>Already saved. </strong>You have a memory with exactly these words.
        </div>
      ) : (
        current?.similar.map((match, index) => (
          <div className="om-notice" key={index} role="alert">
            <strong>{match.kind === 'duplicate' ? 'Possible repeat. ' : 'Possible conflict. '}</strong>
            {match.reason}: “{match.content.length > 90 ? `${match.content.slice(0, 89)}…` : match.content}”. Saving
            keeps both.
          </div>
        ))
      )}
      {error && (
        <div className="om-notice" data-tone="danger" role="alert">
          {error}
        </div>
      )}

      <div className="om-share" role="group" aria-label="Share with">
        <span className="om-hint">Share with</span>
        {SITE_IDS.map((site) => (
          <button
            key={site}
            type="button"
            className="om-chip"
            aria-pressed={share[site]}
            onClick={() => setShare((value) => ({ ...value, [site]: !value[site] }))}
          >
            {SITES[site].label}
          </button>
        ))}
      </div>

      <div className="om-actions">
        <select
          className="om-field om-grow"
          aria-label="Category"
          value={category}
          onChange={(event) => setCategory(event.target.value as Category | '')}
        >
          <option value="">{current ? `Auto · ${current.suggestedCategory}` : 'Auto category'}</option>
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
          {identical ? 'Already saved' : current?.similar.length ? 'Save anyway' : 'Save memory'}
        </button>
      </div>
      <p className="om-hint" style={{ margin: '8px 0 0' }}>
        {sharedWith.length === 0
          ? 'Kept on this device and not shared with any chatbot.'
          : `Saved on this device. ${sharedWith.map((site) => SITES[site].label).join(', ')} can use it.`}{' '}
        Change who gets new memories from {SITES[siteId].label} in the manager’s
        Settings.
      </p>
    </div>
  );
}
