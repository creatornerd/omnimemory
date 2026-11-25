import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, Loader2, Minus, Pencil, Plus, RotateCcw, Sparkles, Undo2 } from 'lucide-react';
import { CHAT_MODEL_LABEL, SHARED_DAILY_LIMIT, type ChatChange, type ChatTurn, type Memory } from '../core';
import { onChange } from '../shared/change-bus';
import { HAS_SHARED_KEY, aiStatus, getAssistant } from '../shared/platform';
import { Badge, Button, Logo, Notice } from '../ui/components/primitives';
import { useToast } from '../ui/components/Toast';
import { cx, plural } from '../ui/format';
import type { Store } from '../ui/hooks/useStore';
import { Help } from './help';

/**
 * Assistant: change your memories by asking. Gemini proposes changes (add,
 * reword, merge, remove); nothing happens until you press Apply, and an
 * applied set can be undone in one click.
 */

interface UndoRecord {
  created: string[];
  deleted: string[];
  edited: { id: string; content: string }[];
}

type Message =
  | { id: number; role: 'user'; text: string }
  | {
      id: number;
      role: 'assistant';
      text: string;
      changes: ChatChange[];
      off: number[];
      status: 'pending' | 'applied' | 'dismissed' | 'undone';
      undo?: UndoRecord;
      fellBack?: boolean;
    }
  | { id: number; role: 'error'; text: string };

// Survives switching pages (cleared by "New chat" or closing the dashboard).
let saved: Message[] = [];
let nextId = 1;

const STARTERS = [
  'Remove repeats and tidy up my memories',
  'What do you know about me?',
  'I moved to a new city — update my memories',
  'Make every memory short and in the first person',
];

function ChangeRow({ change, on, onToggle, disabled }: { change: ChatChange; on: boolean; onToggle: () => void; disabled: boolean }) {
  const Icon = change.kind === 'add' ? Plus : change.kind === 'edit' ? Pencil : Minus;
  return (
    <li className={cx('flex items-start gap-2.5 px-3 py-2', !on && 'opacity-50')}>
      <input
        type="checkbox"
        className="mt-1 size-3.5 shrink-0 cursor-pointer accent-[var(--om-accent)]"
        checked={on}
        disabled={disabled}
        onChange={onToggle}
        aria-label="Include this change"
      />
      <Icon
        size={13}
        className={cx('mt-1 shrink-0', change.kind === 'add' ? 'text-ok' : change.kind === 'delete' ? 'text-danger' : 'text-ink-2')}
        aria-label={change.kind === 'add' ? 'Add' : change.kind === 'edit' ? 'Reword' : 'Remove'}
      />
      <div className="min-w-0 flex-1 text-[13px] leading-relaxed">
        {change.kind === 'add' && (
          <>
            {change.text} <Badge>{change.category}</Badge>
          </>
        )}
        {change.kind === 'edit' && (
          <>
            <p className="text-ink-3 line-through decoration-ink-3/60">{change.memory.content}</p>
            <p>{change.text}</p>
          </>
        )}
        {change.kind === 'delete' && <p className="text-ink-2 line-through decoration-ink-3/60">{change.memory.content}</p>}
      </div>
    </li>
  );
}

export function AssistantView({ store }: { store: Store }) {
  const { service, library, settings } = store;
  const toast = useToast();
  const assistant = getAssistant(settings);
  const [messages, setMessagesState] = useState<Message[]>(saved);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [applying, setApplying] = useState<number | null>(null);
  const [allowance, setAllowance] = useState<{ left: number; limit: number } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const setMessages = (update: (current: Message[]) => Message[]) =>
    setMessagesState((current) => (saved = update(current)));

  // With the shared key, show what's left of today's free actions.
  useEffect(() => {
    const load = () =>
      void aiStatus().then((status) =>
        setAllowance(status.source === 'shared' ? { left: Math.max(0, status.limit - status.used), limit: status.limit } : null),
      );
    load();
    return onChange(load);
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages, thinking]);

  useEffect(() => {
    if (!thinking) return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [thinking]);

  async function send(text: string) {
    const clean = text.trim();
    if (!clean || !assistant || thinking) return;
    const user: Message = { id: nextId++, role: 'user', text: clean };
    const history = [...messages, user];
    setMessages(() => history);
    setDraft('');
    setThinking(true);
    try {
      const turns: ChatTurn[] = history.flatMap((message): ChatTurn[] => {
        if (message.role === 'user') return [{ role: 'user', text: message.text }];
        if (message.role !== 'assistant') return [];
        const note =
          message.changes.length === 0
            ? ''
            : ` (Proposed ${plural(message.changes.length, 'change')}; ${message.status === 'applied' ? 'the person applied them' : message.status === 'undone' ? 'applied, then undone' : 'not applied'}.)`;
        return [{ role: 'assistant', text: message.text + note }];
      });
      const answer = await assistant.chat(turns, library);
      setMessages((current) => [
        ...current,
        {
          id: nextId++,
          role: 'assistant',
          text: answer.reply,
          changes: answer.changes,
          off: [],
          status: 'pending',
          fellBack: answer.fellBack,
        },
      ]);
    } catch (error) {
      setMessages((current) => [...current, { id: nextId++, role: 'error', text: (error as Error).message }]);
    } finally {
      setThinking(false);
      input.current?.focus();
    }
  }

  function update(id: number, patch: Partial<Extract<Message, { role: 'assistant' }>>) {
    setMessages((current) => current.map((message) => (message.id === id && message.role === 'assistant' ? { ...message, ...patch } : message)));
  }

  async function apply(message: Extract<Message, { role: 'assistant' }>) {
    const chosen = message.changes.filter((_, index) => !message.off.includes(index));
    if (chosen.length === 0) return;
    setApplying(message.id);
    const undo: UndoRecord = { created: [], deleted: [], edited: [] };
    try {
      const current = new Map(library.map((memory) => [memory.id, memory]));
      const stale = chosen.find((change) => change.kind !== 'add' && current.get(change.memory.id)?.content !== change.memory.content);
      if (stale) throw new Error('Some of these memories changed since you asked. Ask again to get fresh suggestions.');
      for (const change of chosen) {
        if (change.kind === 'edit') {
          await service.update(change.memory.id, { content: change.text });
          undo.edited.push({ id: change.memory.id, content: change.memory.content });
        }
      }
      const deletes = chosen.flatMap((change) => (change.kind === 'delete' ? [change.memory.id] : []));
      if (deletes.length > 0) {
        await service.remove(deletes);
        undo.deleted.push(...deletes);
      }
      for (const change of chosen) {
        if (change.kind === 'add') {
          const created = await service.create({ content: change.text, category: change.category, source: 'manual' });
          undo.created.push(created.id);
        }
      }
      update(message.id, { status: 'applied', undo });
      toast(`Applied ${plural(chosen.length, 'change')}. Synced chatbots will be updated.`);
    } catch (error) {
      toast((error as Error).message);
      if (undo.created.length || undo.deleted.length || undo.edited.length) update(message.id, { status: 'applied', undo });
    } finally {
      setApplying(null);
    }
  }

  async function revert(message: Extract<Message, { role: 'assistant' }>) {
    if (!message.undo) return;
    setApplying(message.id);
    try {
      const { created, deleted, edited } = message.undo;
      if (created.length > 0) {
        await service.remove(created);
        await service.purge(created);
      }
      if (deleted.length > 0) await service.restore(deleted);
      for (const item of edited) await service.update(item.id, { content: item.content });
      update(message.id, { status: 'undone' });
      toast('Undone. Your memories are back as they were.');
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setApplying(null);
    }
  }

  if (!assistant) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <Sparkles size={22} className="mx-auto text-ink-3" />
          <h1 className="mt-3 text-[22px] font-semibold tracking-[-0.02em]">Edit your memories by asking</h1>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">
            “Remove the repeats”, “I moved to Austin”, “What do you know about me?” — the Assistant suggests the changes
            and you approve them.{' '}
            {HAS_SHARED_KEY
              ? `Turn it on in Settings to get ${SHARED_DAILY_LIMIT} free actions a day, or add your own Gemini key for unlimited use.`
              : 'It needs your Gemini API key.'}
          </p>
          <Button className="mt-4" variant="primary" onClick={() => (window.location.hash = '/settings')}>
            Set up in Settings
          </Button>
        </div>
      </div>
    );
  }

  const shared = library.filter((memory: Memory) => memory.enabled).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-[840px] items-start gap-3 px-10 pt-8 pb-2 max-md:px-5">
        <div className="mr-auto">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="flex items-center gap-1.5 text-[22px] font-semibold tracking-[-0.02em]">
              Assistant <Help id="assistant.page" />
            </h1>
            <span className="inline-flex h-[22px] items-center rounded-md bg-muted px-2 text-xs font-medium text-ink-2">
              {CHAT_MODEL_LABEL}
            </span>
          </div>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">
            Change your memories by asking, even several things at once. Nothing changes until you tick what you want and press Apply, and Undo puts everything back. It only answers questions about your memories and OmniMemory.
            {allowance && ` · ${allowance.left} of ${allowance.limit} free AI actions left today`}
          </p>
        </div>
        {messages.length > 0 && (
          <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} disabled={thinking} onClick={() => setMessages(() => [])}>
            New chat
          </Button>
        )}
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] space-y-[18px] px-10 py-6 max-md:px-5">
          {messages.length === 0 && (
            <div className="py-10 text-center">
              <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-subtle">
                <Sparkles size={18} />
              </span>
              <p className="mt-3 text-sm font-semibold">What should change?</p>
              <p className="mt-1 text-xs text-ink-3">
                The Assistant can see your {plural(shared, 'shared memory', 'shared memories')}. Private ones stay hidden.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {STARTERS.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    className="h-7 rounded-full border border-line bg-surface px-[11px] text-[12.5px] text-ink-2 hover:border-line-strong hover:text-ink"
                    onClick={() => (starter.includes('—') ? (setDraft(starter.replace(/ — .*/, ' to ')), input.current?.focus()) : void send(starter))}
                  >
                    {starter}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => {
            if (message.role === 'user') {
              return (
                <div key={message.id} className="flex justify-end">
                  <p className="max-w-[80%] rounded-[14px] bg-muted px-3.5 py-2.5 text-sm leading-normal whitespace-pre-wrap text-ink">
                    {message.text}
                  </p>
                </div>
              );
            }
            if (message.role === 'error') {
              return (
                <Notice key={message.id} tone="danger">
                  {message.text}
                </Notice>
              );
            }
            const chosen = message.changes.length - message.off.length;
            const busy = applying === message.id;
            return (
              <div key={message.id} className="flex gap-3">
                <span className="mt-0.5 shrink-0">
                  <Logo size={24} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="mt-0.5 text-sm leading-normal whitespace-pre-wrap">{message.text}</p>
                  {message.fellBack && (
                    <p className="mt-1 text-[11px] text-ink-3">Gemini 3.5 Flash was busy, so Flash Lite answered.</p>
                  )}
                  {message.changes.length > 0 && (
                    <div className="mt-2.5 overflow-hidden rounded-xl border border-line bg-surface">
                      <ul className="max-h-80 divide-y divide-line overflow-y-auto">
                        {message.changes.map((change, index) => (
                          <ChangeRow
                            key={index}
                            change={change}
                            on={!message.off.includes(index)}
                            disabled={message.status !== 'pending'}
                            onToggle={() =>
                              update(message.id, {
                                off: message.off.includes(index)
                                  ? message.off.filter((value) => value !== index)
                                  : [...message.off, index],
                              })
                            }
                          />
                        ))}
                      </ul>
                      <div className="flex items-center justify-end gap-2 border-t border-line bg-canvas px-3 py-2.5">
                        {message.status === 'pending' && (
                          <>
                            <Button
                              size="sm"
                              variant="primary"
                              icon={busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                              disabled={busy || chosen === 0}
                              onClick={() => void apply(message)}
                            >
                              Apply {plural(chosen, 'change')}
                            </Button>
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => update(message.id, { status: 'dismissed' })}>
                              Dismiss
                            </Button>
                          </>
                        )}
                        {message.status === 'applied' && (
                          <>
                            <span className="flex items-center gap-1 text-xs text-ok">
                              <Check size={13} /> Applied
                            </span>
                            <Button size="sm" variant="ghost" icon={<Undo2 size={13} />} disabled={busy} onClick={() => void revert(message)}>
                              Undo
                            </Button>
                          </>
                        )}
                        {message.status === 'undone' && <span className="text-xs text-ink-3">Undone</span>}
                        {message.status === 'dismissed' && <span className="text-xs text-ink-3">Dismissed</span>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {thinking && (
            <div className="flex items-center gap-2 text-xs text-ink-3">
              <Loader2 size={14} className="animate-spin" />
              Reading your memories{seconds >= 6 ? ` · ${seconds}s (Gemini is busy, hang on)` : '…'}
            </div>
          )}
          <div ref={bottom} />
        </div>
      </div>

      <form
        className="px-10 pt-2 pb-5 max-md:px-5"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <div className="mx-auto flex max-w-[760px] items-end gap-2.5 rounded-[14px] border border-line-strong bg-surface py-2.5 pr-2.5 pl-4 focus-within:border-brand">
          <textarea
            ref={input}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send(draft);
              }
            }}
            rows={1}
            placeholder="e.g. “Merge everything about my job into one memory”"
            aria-label="Message the Assistant"
            className="max-h-40 min-h-8 flex-1 resize-none bg-transparent py-1 text-sm leading-normal outline-none"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={thinking || !draft.trim()}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg hover:bg-accent-hover disabled:opacity-40"
          >
            <ArrowUp size={16} />
          </button>
        </div>
        <p className="mx-auto mt-2 max-w-[760px] text-center text-[11.5px] text-ink-3">
          Private memories and anything that looks like a password are never sent.
        </p>
      </form>
    </div>
  );
}
