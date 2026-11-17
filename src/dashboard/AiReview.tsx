import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronRight, Loader2, Sparkles } from 'lucide-react';
import type { Category, FoundItem, ImportPlan, ImportSuggestion, MemoryAssistant, SiteId } from '../core';
import { getSyncService } from '../shared/platform';
import { SITES } from '../shared/sites';
import { Badge, Button, Notice } from '../ui/components/primitives';
import { useToast } from '../ui/components/Toast';
import { cx, plural } from '../ui/format';
import type { Store } from '../ui/hooks/useStore';

/**
 * The Review page with the AI assistant on: everything the chatbots remember,
 * turned into one de-duplicated list of first-person memories. Items the
 * library already has, and items the AI left out, stay visible so nothing
 * disappears without the user seeing it.
 */

interface Planned {
  key: string;
  plan?: ImportPlan;
  error?: string;
}

// Survives leaving and coming back to the Review page.
let cached: Planned | null = null;

const keyOf = (found: FoundItem[]) => found.map((item) => item.id).sort().join('|');

function covered(plan: ImportPlan): Set<string> {
  return new Set([
    ...plan.suggestions.flatMap((s) => s.foundIds),
    ...plan.alreadyHave.flatMap((a) => a.foundIds),
    ...plan.leftOut,
  ]);
}

/** The plan narrowed to what's still on the list (after keeping some). */
function narrow(plan: ImportPlan, ids: Set<string>): ImportPlan {
  const keep = (foundIds: string[]) => foundIds.filter((id) => ids.has(id));
  return {
    suggestions: plan.suggestions
      .map((s) => ({ ...s, foundIds: keep(s.foundIds) }))
      .filter((s) => s.foundIds.length > 0),
    alreadyHave: plan.alreadyHave.map((a) => ({ ...a, foundIds: keep(a.foundIds) })).filter((a) => a.foundIds.length > 0),
    leftOut: keep(plan.leftOut),
  };
}

/** Run the AI once per set of finds; reuse the answer while the list only shrinks. */
export function useImportPlan(assistant: MemoryAssistant | null, found: FoundItem[], store: Store) {
  const key = keyOf(found);
  const ids = useMemo(() => new Set(found.map((item) => item.id)), [found]);
  const [state, setState] = useState<Planned | null>(cached);
  const [attempt, setAttempt] = useState(0);
  const handledAttempt = useRef(0);

  const stillCovered = !!state?.plan && found.every((item) => covered(state.plan as ImportPlan).has(item.id));

  useEffect(() => {
    if (!assistant || found.length === 0 || store.loading) return;
    const retrying = attempt !== handledAttempt.current;
    handledAttempt.current = attempt;
    if (!retrying && (stillCovered || state?.key === key)) return;
    let cancelled = false;
    setState({ key });
    assistant
      .planImport(found, store.library)
      .then((plan) => {
        cached = { key, plan };
        if (!cancelled) setState(cached);
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ key, error: error.message });
      });
    return () => {
      cancelled = true;
    };
    // Re-plan only for a new set of finds or a retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistant, key, store.loading, attempt]);

  const plan = state?.plan && stillCovered ? narrow(state.plan, ids) : undefined;
  const error = state?.key === key ? state.error : undefined;
  return {
    plan,
    loading: !!assistant && found.length > 0 && !plan && !error,
    error,
    retry: () => setAttempt((value) => value + 1),
  };
}

function Sources({ ids, byId }: { ids: string[]; byId: Map<string, FoundItem> }) {
  const sites = [...new Set(ids.map((id) => byId.get(id)?.site).filter(Boolean))] as SiteId[];
  return (
    <span className="flex items-center gap-1">
      {sites.map((site) => (
        <span key={site} className="flex items-center gap-1">
          <span className="size-2 rounded-full" style={{ background: SITES[site].color }} aria-hidden="true" />
          {SITES[site].label}
        </span>
      ))}
      {ids.length > 1 && <span className="text-ink-3">· combined {ids.length}</span>}
    </span>
  );
}

function Fold({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-5">
      <button
        type="button"
        className="flex items-center gap-1 text-xs font-medium text-ink-2 hover:text-ink"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight size={13} className={cx('transition-transform', open && 'rotate-90')} />
        {title}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </section>
  );
}

export function AiReview({
  found,
  plan,
  loading,
  error,
  onRetry,
  onShowOriginal,
}: {
  found: FoundItem[];
  plan?: ImportPlan;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onShowOriginal: () => void;
}) {
  const toast = useToast();
  const byId = useMemo(() => new Map(found.map((item) => [item.id, item])), [found]);
  // Keys: "s:<index>" for suggestions, "l:<foundId>" for left-out items.
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  // Suggestions start ticked, except possible contradictions; left-out items start unticked.
  useEffect(() => {
    if (!plan) return;
    setTicked(new Set(plan.suggestions.flatMap((s, index) => (s.conflictsWith ? [] : [`s:${index}`]))));
    setEdits({});
  }, [plan]);

  if (loading || (!plan && !error)) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center text-xs text-ink-3">
        <Loader2 size={18} className="animate-spin" />
        <p>Gemini is turning {plural(found.length, 'find', 'finds')} from your chatbots into one tidy list…</p>
        <button type="button" className="text-ink-2 underline-offset-2 hover:underline" onClick={onShowOriginal}>
          Show the original list instead
        </button>
      </div>
    );
  }

  if (error || !plan) {
    return (
      <div className="mt-4 space-y-3">
        <Notice tone="danger">{error}</Notice>
        <div className="flex gap-2">
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
          <Button size="sm" variant="ghost" onClick={onShowOriginal}>
            Show the original list
          </Button>
        </div>
      </div>
    );
  }

  const textOf = (s: ImportSuggestion, index: number) => edits[index] ?? s.text;
  const keepCount = [...ticked].length;

  async function keep() {
    if (!plan) return;
    setBusy(true);
    try {
      const keepItems: { id: string; text: string; category?: Category }[] = [];
      const handled = new Set<string>();
      plan.suggestions.forEach((s, index) => {
        for (const id of s.foundIds) handled.add(id);
        if (!ticked.has(`s:${index}`)) return;
        // Prefer the item that came with a chatbot entry id, so it gets linked, not copied.
        const primary = s.foundIds.find((id) => byId.get(id)?.remoteId) ?? s.foundIds[0];
        keepItems.push({ id: primary, text: textOf(s, index).trim(), category: s.category });
      });
      for (const id of plan.leftOut) {
        handled.add(id);
        const item = byId.get(id);
        if (item && ticked.has(`l:${id}`)) keepItems.push({ id, text: item.text });
      }
      for (const a of plan.alreadyHave) for (const id of a.foundIds) handled.add(id);
      const keepIds = new Set(keepItems.map((item) => item.id));
      const skip = [...handled].filter((id) => !keepIds.has(id));
      const result = await getSyncService().review(
        keepItems.filter((item) => item.text),
        skip,
      );
      const parts = [
        result.added > 0 ? `Added ${plural(result.added, 'memory', 'memories')} — syncing to your chatbots` : 'Nothing added',
      ];
      if (result.refused.length > 0) parts.push(`${result.refused.length} skipped because it looks like a password or key`);
      toast(parts.join('. '));
    } catch (cause) {
      toast((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (key: string, on: boolean) =>
    setTicked((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  return (
    <>
      <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 text-xs leading-relaxed text-ink-2">
        <Sparkles size={14} className="mt-0.5 shrink-0" />
        <p className="flex-1">
          Gemini turned {plural(found.length, 'find', 'finds')} from your chatbots into{' '}
          <strong className="text-ink">{plural(plan.suggestions.length, 'memory', 'memories')}</strong>
          {plan.alreadyHave.length > 0 && <>, and set aside {plan.alreadyHave.length} you already have</>}. Click any text
          to reword it.
        </p>
        <button type="button" className="shrink-0 text-ink-2 hover:text-ink" onClick={onShowOriginal}>
          Original list
        </button>
      </div>

      {plan.suggestions.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line bg-surface">
          {plan.suggestions.map((s, index) => {
            const key = `s:${index}`;
            const on = ticked.has(key);
            return (
              <li key={key} className={cx('flex items-start gap-3 px-3 py-2.5', !on && 'opacity-60')}>
                <input
                  type="checkbox"
                  className="mt-1.5 size-3.5 shrink-0 cursor-pointer accent-[var(--om-accent)]"
                  checked={on}
                  onChange={(event) => toggle(key, event.target.checked)}
                  aria-label={`Keep: ${textOf(s, index)}`}
                />
                <div className="min-w-0 flex-1">
                  <input
                    value={textOf(s, index)}
                    onChange={(event) => setEdits((current) => ({ ...current, [index]: event.target.value }))}
                    aria-label="Memory text"
                    className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-[13px] leading-relaxed text-ink hover:border-line focus:border-line-strong focus:outline-none"
                  />
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[11px] text-ink-2">
                    <Badge>{s.category}</Badge>
                    <Sources ids={s.foundIds} byId={byId} />
                  </p>
                  {s.conflictsWith && (
                    <p className="mt-1.5 flex items-start gap-1.5 px-1 text-[11px] leading-relaxed text-warn">
                      <AlertTriangle size={12} className="mt-px shrink-0" />
                      <span>
                        {s.reason ?? 'May contradict a memory you have'}: “{s.conflictsWith.content}”. Starts unticked.
                      </span>
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {plan.alreadyHave.length > 0 && (
        <Fold title={`Already in OmniMemory (${plan.alreadyHave.length})`}>
          <ul className="space-y-1.5 text-xs text-ink-2">
            {plan.alreadyHave.map((a) => (
              <li key={a.foundIds.join()} className="rounded-md border border-line px-2.5 py-1.5">
                “{byId.get(a.foundIds[0])?.text}” <span className="text-ink-3">matches</span> “{a.memory.content}”
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-ink-3">These won’t be added again.</p>
        </Fold>
      )}

      {plan.leftOut.length > 0 && (
        <Fold title={`Left out by Gemini (${plan.leftOut.length})`}>
          <p className="mb-1.5 text-[11px] text-ink-3">Not about you, or not worth a memory. Tick any you want anyway.</p>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {plan.leftOut.map((id) => {
              const item = byId.get(id);
              if (!item) return null;
              return (
                <li key={id} className="flex items-start gap-3 px-3 py-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-3.5 shrink-0 cursor-pointer accent-[var(--om-accent)]"
                    checked={ticked.has(`l:${id}`)}
                    onChange={(event) => toggle(`l:${id}`, event.target.checked)}
                    aria-label={`Keep: ${item.text}`}
                  />
                  <span className="flex-1">{item.text}</span>
                  <span className="text-[11px] text-ink-3">{SITES[item.site].label}</span>
                </li>
              );
            })}
          </ul>
        </Fold>
      )}

      <div className="sticky bottom-0 mt-6 flex items-center gap-3 border-t border-line bg-canvas py-3">
        <p className="mr-auto text-xs text-ink-2">
          {keepCount > 0 ? `Keep ${keepCount}` : 'Nothing ticked'}
          <span className="text-ink-3"> · the rest won’t be suggested again</span>
        </p>
        <Button variant="primary" disabled={busy} onClick={() => void keep()}>
          {keepCount > 0 ? `Keep ${keepCount} and sync` : 'Skip all'}
        </Button>
      </div>
    </>
  );
}
