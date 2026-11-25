import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCheck, RefreshCw, RotateCcw, Sparkles } from 'lucide-react';
import { SITE_IDS, SYNC_MODES, syncBlocked, type FoundItem, type SiteId } from '../core';
import { getAssistant, getSyncService, isExtension } from '../shared/platform';
import { AiReview, useImportPlan } from './AiReview';
import { SITES } from '../shared/sites';
import { Badge, Button } from '../ui/components/primitives';
import { useToast } from '../ui/components/Toast';
import { cx, plural } from '../ui/format';
import { useFound } from '../ui/hooks/useFound';
import type { Store } from '../ui/hooks/useStore';
import { Help } from './help';

/** Ask every chatbot that syncs to re-read what it remembers. */
async function scanAll(store: Store): Promise<number> {
  if (!isExtension()) throw new Error('Scanning only works in the installed extension.');
  let started = 0;
  for (const site of SITE_IDS) {
    if (!SYNC_MODES[site] || syncBlocked(store.settings, site)) continue;
    const response = (await chrome.runtime.sendMessage({ type: 'omni/sync-run', site })) as { ok: boolean } | undefined;
    if (response?.ok) started += 1;
  }
  return started;
}

function Row({
  item,
  checked,
  text,
  onCheck,
  onText,
}: {
  item: FoundItem;
  checked: boolean;
  text: string;
  onCheck: (on: boolean) => void;
  onText: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const changed = text !== item.text;
  return (
    <li className={cx('flex items-start gap-3 py-3 pr-3.5 pl-4', !checked && 'opacity-60')}>
      <input
        type="checkbox"
        className="mt-1 size-4 shrink-0 cursor-pointer accent-(--om-brand)"
        checked={checked}
        onChange={(event) => onCheck(event.target.checked)}
        aria-label={`Keep: ${text}`}
      />
      <div className="min-w-0 flex-1">
        {editing ? (
          <textarea
            autoFocus
            className="w-full resize-y rounded-md border border-line-strong bg-surface px-2 py-1.5 text-[13px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-focus"
            rows={Math.min(6, Math.max(2, Math.ceil(text.length / 70)))}
            value={text}
            onChange={(event) => onText(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={() => setEditing(false)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                setEditing(false);
              }
              if (event.key === 'Escape') {
                onText(item.text);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="w-full cursor-text rounded text-left text-sm leading-normal text-ink hover:bg-subtle"
            title="Click to edit before keeping"
            onClick={() => setEditing(true)}
          >
            {text}
          </button>
        )}
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
          <span>
            {item.title ? `${item.title} · ` : ''}
            {item.source}
          </span>
          {item.alsoOn && (
            <span className="inline-flex items-center gap-1" title="Shown once here; your choice counts for every copy">
              · Also on
              {item.alsoOn.map((site) => (
                <span key={site} className="inline-flex items-center gap-1">
                  <span className="size-1.5 rounded-full" style={{ background: SITES[site].color }} aria-hidden="true" />
                  {SITES[site].label}
                </span>
              ))}
            </span>
          )}
          {changed && <Badge>Edited</Badge>}
        </p>
        {item.conflictsWith && (
          <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-warn">
            <AlertTriangle size={12} className="mt-px shrink-0" />
            <span>
              {item.conflictReason ?? 'Similar to a memory you have'}: “{item.conflictsWith}”. Starts unticked so you
              don’t end up with both.
            </span>
          </p>
        )}
      </div>
    </li>
  );
}

export function ReviewView({ store }: { store: Store }) {
  const { found, loading } = useFound();
  const toast = useToast();
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const assistant = getAssistant(store.settings);
  const [showOriginal, setShowOriginal] = useState(false);
  const ai = useImportPlan(assistant, found, store);
  const aiMode = !!assistant && !showOriginal && found.length > 0;

  // New items flagged as possible contradictions start unticked; after that
  // the user's own ticks win.
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const fresh = found.filter((item) => !seen.current.has(item.id));
    for (const item of fresh) seen.current.add(item.id);
    const conflicts = fresh.filter((item) => item.conflictsWith);
    if (conflicts.length === 0) return;
    setUnchecked((current) => new Set([...current, ...conflicts.map((item) => item.id)]));
  }, [found]);

  const bySite = useMemo(() => {
    const groups: [SiteId, FoundItem[]][] = [];
    for (const site of SITE_IDS) {
      const items = found.filter((item) => item.site === site);
      if (items.length > 0) groups.push([site, items]);
    }
    return groups;
  }, [found]);

  const keepCount = found.filter((item) => !unchecked.has(item.id)).length;
  const skipCount = found.length - keepCount;
  const textOf = (item: FoundItem) => edits[item.id] ?? item.text;

  /** Keep every item from one chatbot as it stands (with any rewording). */
  async function keepAllFrom(site: SiteId, items: FoundItem[]) {
    setBusy(true);
    try {
      const keep = items.map((item) => ({ id: item.id, text: textOf(item) })).filter((item) => item.text.trim());
      const result = await getSyncService().review(keep, []);
      setUnchecked((current) => new Set([...current].filter((id) => !items.some((item) => item.id === id))));
      const parts = [`Kept ${plural(result.added, 'memory', 'memories')} from ${SITES[site].label}`];
      if (result.refused.length > 0) parts.push(`${result.refused.length} skipped because it looks like a password or key`);
      toast(parts.join('. '));
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    try {
      const keep = found
        .filter((item) => !unchecked.has(item.id))
        .map((item) => ({ id: item.id, text: textOf(item) }))
        .filter((item) => item.text.trim());
      const skip = found.filter((item) => unchecked.has(item.id)).map((item) => item.id);
      const result = await getSyncService().review(keep, skip);
      setEdits({});
      setUnchecked(new Set());
      const parts = [
        result.added > 0 ? `Added ${plural(result.added, 'memory', 'memories')} — syncing to your chatbots` : 'Nothing added',
      ];
      if (result.refused.length > 0) parts.push(`${result.refused.length} skipped because it looks like a password or key`);
      toast(parts.join('. '));
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function scan() {
    setScanning(true);
    try {
      const started = await scanAll(store);
      toast(started > 0 ? 'Checking your chatbots…' : 'Turn on sync for a chatbot to scan it.');
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setTimeout(() => setScanning(false), 2500);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-[900px] flex-wrap items-start gap-4 px-10 pt-8 pb-2 max-md:px-5">
        <div className="mr-auto">
          <h1 className="flex items-center gap-1.5 text-[22px] font-semibold tracking-[-0.02em]">
            Review <Help id="review.page" />
          </h1>
          <p className="mt-1.5 max-w-[620px] text-[13.5px] leading-relaxed text-ink-2">
            {loading
              ? 'Loading…'
              : found.length === 0
                ? 'Things your chatbots remember that OmniMemory doesn’t show up here.'
                : `${plural(found.length, 'thing', 'things')} your chatbots remember that OmniMemory doesn’t. Keep what’s useful; the rest won’t come back.`}
          </p>
        </div>
        <Button icon={<RefreshCw size={14} className={scanning ? 'animate-spin' : ''} />} disabled={scanning} onClick={() => void scan()}>
          Scan chatbots now
        </Button>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[900px] px-10 pt-2 pb-28 max-md:px-5">

          {assistant && showOriginal && found.length > 0 && (
            <div className="mt-3 flex justify-end">
              <Button size="sm" icon={<Sparkles size={13} />} onClick={() => setShowOriginal(false)}>
                Back to Gemini’s tidy list
              </Button>
            </div>
          )}

          {aiMode && (
            <AiReview
              found={found}
              plan={ai.plan}
              loading={ai.loading}
              error={ai.error}
              onRetry={ai.retry}
              onShowOriginal={() => setShowOriginal(true)}
            />
          )}

          {!loading && found.length === 0 && (
            <div className="py-16 text-center">
              <Sparkles size={20} className="mx-auto text-ink-3" />
              <p className="mt-2 text-[13px] font-medium">Nothing to review</p>
              <p className="mt-1 text-xs text-ink-3">
                Everything your chatbots remember is already in OmniMemory. New finds show up here after each sync.
              </p>
            </div>
          )}

          {!aiMode && bySite.map(([site, items]) => {
            const allOn = items.every((item) => !unchecked.has(item.id));
            return (
              <section key={site} className="mt-6">
                <div className="mb-2 flex items-center gap-2">
                  <span className="size-2 rounded-full" style={{ background: SITES[site].color }} aria-hidden="true" />
                  <h2 className="text-[13.5px] font-semibold">From {SITES[site].label}</h2>
                  <span className="text-xs text-ink-3">{items.length}</span>
                  <button
                    type="button"
                    className="ml-auto text-[12.5px] font-medium text-brand hover:text-brand-hover"
                    onClick={() =>
                      setUnchecked((current) => {
                        const next = new Set(current);
                        for (const item of items) {
                          if (allOn) next.add(item.id);
                          else next.delete(item.id);
                        }
                        return next;
                      })
                    }
                  >
                    {allOn ? 'Untick all' : 'Tick all'}
                  </button>
                  <Button
                    size="sm"
                    icon={<CheckCheck size={13} />}
                    disabled={busy}
                    onClick={() => void keepAllFrom(site, items)}
                  >
                    Keep all {items.length}
                  </Button>
                </div>
                <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
                  {items.map((item) => (
                    <Row
                      key={item.id}
                      item={item}
                      checked={!unchecked.has(item.id)}
                      text={textOf(item)}
                      onCheck={(on) =>
                        setUnchecked((current) => {
                          const next = new Set(current);
                          if (on) next.delete(item.id);
                          else next.add(item.id);
                          return next;
                        })
                      }
                      onText={(text) => setEdits((current) => ({ ...current, [item.id]: text }))}
                    />
                  ))}
                </ul>
              </section>
            );
          })}

          <div className="mt-8 flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              icon={<RotateCcw size={13} />}
              onClick={() =>
                void getSyncService()
                  .resetSkipped()
                  .then(() => toast('Skipped suggestions will come back at the next scan'))
              }
            >
              Bring back skipped suggestions
            </Button>
          </div>
        </div>
      </div>

      {found.length > 0 && !aiMode && (
        <footer className="mx-auto mb-5 flex w-[calc(100%-80px)] max-w-[820px] flex-wrap items-center gap-3 rounded-xl bg-accent py-2.5 pr-2.5 pl-[18px] text-accent-fg shadow-pop max-md:w-[calc(100%-40px)]">
          <p className="text-[13px] font-medium">{keepCount} of {keepCount + skipCount} ticked</p>
          <p className="mr-auto text-[12.5px] opacity-65">Unticked ones won’t be suggested again.</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void apply()}
            className="h-[34px] rounded-lg bg-canvas px-3.5 text-[13px] font-semibold text-ink hover:opacity-90 disabled:opacity-50"
          >
            {keepCount > 0 ? `Keep and sync ${keepCount}` : `Skip ${skipCount}`}
          </button>
        </footer>
      )}
    </div>
  );
}
