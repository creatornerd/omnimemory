import { useEffect, useRef, useState } from 'react';
import { withoutContext } from '../../core/context';
import { onChange } from '../../shared/change-bus';
import { MAX_FIT_DRAFT, MAX_FIT_RECENT, type FitResult, type SharedMemory } from '../../shared/messages';
import type { SiteAdapter } from '../adapters';
import { send } from '../bridge';

/**
 * Which memories fit the message being typed. Used by the bar above the
 * message box and by the panel's "Suggested for this chat"; the service
 * worker remembers recent answers, so both share one request.
 */

/** Wait this long after the last keystroke before asking. */
const SETTLE_MS = 900;
/** Shorter drafts ("hi", "ok") don't say enough to pick anything. */
export const MIN_FIT_DRAFT = 12;

export const flat = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** What's in the message box right now, re-read as it changes. */
export function useDraft(adapter: SiteAdapter): string {
  const [text, setText] = useState(() => adapter.readDraft());
  useEffect(() => {
    const read = () => setText(adapter.readDraft());
    const timer = setInterval(read, 800);
    document.addEventListener('input', read, true);
    return () => {
      clearInterval(timer);
      document.removeEventListener('input', read, true);
    };
  }, [adapter]);
  return text;
}

/** The typed message without any memories already added to it. */
export function ownWords(draft: string): string {
  return withoutContext(draft).replace(/\s+/g, ' ').trim();
}

/** The last part of the chat before the draft, without OmniMemory's own blocks. */
function recentChat(adapter: SiteAdapter, draft: string): string {
  const typed = draft.replace(/\s+/g, ' ').trim();
  let tail = adapter.readConversationTail(MAX_FIT_RECENT * 2 + typed.length);
  if (typed && tail.endsWith(typed)) tail = tail.slice(0, -typed.length);
  return withoutContext(tail).replace(/\s+/g, ' ').trim().slice(-MAX_FIT_RECENT);
}

export interface Fit extends FitResult {
  /** The words this answer is for. */
  draft: string;
}

/**
 * Asks once the draft has settled (and again when memories change). With
 * `includeChat`, an empty draft is answered from the chat on screen instead.
 */
export function useFit(adapter: SiteAdapter, draft: string, { enabled = true, includeChat = false } = {}): Fit | null {
  const words = ownWords(draft);
  const [fit, setFit] = useState<Fit | null>(null);
  const [revision, setRevision] = useState(0);
  const latest = useRef(0);

  useEffect(() => onChange(() => setRevision((value) => value + 1)), []);

  const usable = words.length >= MIN_FIT_DRAFT || (includeChat && words.length === 0);
  useEffect(() => {
    if (!enabled || !usable) {
      setFit(null);
      return;
    }
    const ask = latest.current + 1;
    latest.current = ask;
    // The first ask (opening the panel) goes straight away.
    const timer = setTimeout(
      () => {
        const recent = recentChat(adapter, draft);
        if (!words && !recent) return;
        send({ type: 'context/fit', draft: words.slice(-MAX_FIT_DRAFT), recent })
          .then((result) => {
            if (latest.current === ask) setFit({ ...result, draft: words });
          })
          .catch(() => {
            if (latest.current === ask) setFit({ items: [], by: 'words', draft: words });
          });
      },
      fit === null && includeChat ? 0 : SETTLE_MS,
    );
    return () => clearTimeout(timer);
    // `draft` and `fit` are read when the timer fires; asking again is driven by the words.
  }, [adapter, words, enabled, usable, revision]);

  return fit;
}

/** Memories already written into the message box (by an earlier "Add"). */
export function inMessage(adapter: SiteAdapter, memories: SharedMemory[]): Set<string> {
  const text = flat(adapter.readDraft());
  if (!text) return new Set();
  return new Set(memories.filter((memory) => text.includes(flat(memory.content))).map((memory) => memory.id));
}
