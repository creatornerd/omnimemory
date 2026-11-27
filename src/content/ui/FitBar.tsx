import { useEffect, useState } from 'react';
import { Plus, Sparkles, X } from 'lucide-react';
import { CONTEXT_FOOTER } from '../../core/context';
import type { SiteAdapter } from '../adapters';
import { send } from '../bridge';
import { inMessage, ownWords, useDraft, useFit } from './fit';

const GAP = 6;
/** Below this much room, only the count and Add are shown. */
const ROOM_FOR_TEXT = 190;
const MAX_WIDTH = 440;

/**
 * Appears beside the Memory button, just above the message box, when some of
 * your memories fit what you're typing. "Add" puts them into the message
 * (you still read it before sending); the text opens the panel with them
 * ticked, to pick; × hides the bar until you start a new message.
 */
export function FitBar({
  adapter,
  pill,
  hidden,
  onOpen,
  onDone,
}: {
  adapter: SiteAdapter;
  /** Where the Memory button is. */
  pill: { left: number; top: number };
  /** The panel is open, or a message is showing in this spot. */
  hidden: boolean;
  onOpen: (ids: string[]) => void;
  onDone: (message: string) => void;
}) {
  const draft = useDraft(adapter);
  const fit = useFit(adapter, draft);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const words = ownWords(draft);

  // A new message (the box was emptied, usually by sending) starts afresh.
  useEffect(() => {
    if (!words) setDismissed(new Set());
  }, [words]);

  const present = fit ? inMessage(adapter, fit.items) : new Set<string>();
  const items = (fit?.items ?? []).filter((memory) => !dismissed.has(memory.id) && !present.has(memory.id));
  if (hidden || items.length === 0) return null;

  // From the button leftwards, never past the message box's own left edge.
  const composer = adapter.findComposer();
  const boxLeft = composer ? adapter.findAnchor(composer).getBoundingClientRect().left : GAP;
  const room = Math.min(MAX_WIDTH, pill.left - GAP - Math.max(boxLeft, GAP));
  if (room < 110) return null;
  const roomy = room >= ROOM_FOR_TEXT;
  const count = items.length === 1 ? '1 memory fits' : `${items.length} memories fit`;
  const list = items.map((memory) => memory.content).join(' · ');

  async function add() {
    setBusy(true);
    try {
      const built = await send({ type: 'context/build', ids: items.map((memory) => memory.id) });
      if (built.text && (await adapter.insert(built.text, CONTEXT_FOOTER))) {
        void send({ type: 'context/used', ids: built.includedIds }).catch(() => {});
        const n = built.includedIds.length;
        onDone(`Added ${n === 1 ? '1 memory' : `${n} memories`}. Check it before sending.`);
      } else {
        // The panel can copy it instead.
        onOpen(items.map((memory) => memory.id));
      }
    } catch {
      onOpen(items.map((memory) => memory.id));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="om-fit"
      role="group"
      aria-label="Memories that fit this message"
      style={{ right: window.innerWidth - pill.left + GAP, top: pill.top, maxWidth: room }}
    >
      <button
        type="button"
        className="om-fit-text"
        title={`Choose which to add: ${list}`}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => onOpen(items.map((memory) => memory.id))}
      >
        <Sparkles size={13} aria-hidden="true" />
        <span className="om-fit-count">{count}</span>
        {roomy && <span className="om-fit-list">{list}</span>}
      </button>
      <button
        type="button"
        className="om-fit-add"
        disabled={busy}
        title={`Add to your message: ${list}`}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => void add()}
      >
        <Plus size={12} aria-hidden="true" /> Add
      </button>
      <button
        type="button"
        className="om-fit-x"
        aria-label="Hide these suggestions"
        title="Not for this message"
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => setDismissed((current) => new Set([...current, ...items.map((memory) => memory.id)]))}
      >
        <X size={12} aria-hidden="true" />
      </button>
      <span className="om-sr" role="status">
        {count} this message.
      </span>
    </div>
  );
}
