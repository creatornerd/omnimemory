import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Send } from 'lucide-react';
import type { SiteId } from '../core';
import { SITES } from '../shared/sites';
import { Logo } from '../ui/components/primitives';
import { cx } from '../ui/format';

/**
 * Little animated demos for the welcome tour. Each one is a mock of the real
 * UI driven by a timeline of phases, with a pretend cursor doing the clicks.
 * With "reduce motion" on, each shows its final state and stays still.
 */

const SITE_ORDER: SiteId[] = ['chatgpt', 'claude', 'gemini'];

function useReducedMotion(): boolean {
  const [reduced] = useState(() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  });
  return reduced;
}

/** Step through phases of the given lengths (ms). Loops unless `onDone` is given. */
function useTimeline(durations: number[], onDone?: () => void): number {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (reduced) return;
    const timer = setTimeout(() => {
      if (phase < durations.length - 1) setPhase(phase + 1);
      else if (done.current) done.current();
      else setPhase(0);
    }, durations[phase]);
    return () => clearTimeout(timer);
    // durations are constant for each demo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, reduced]);
  return reduced ? durations.length - 1 : phase;
}

/** Type `text` out a letter at a time once `active` is true. */
function useTyped(text: string, active: boolean, msPerChar = 32): string {
  const reduced = useReducedMotion();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!active) {
      setCount(0);
      return;
    }
    if (count >= text.length) return;
    const timer = setTimeout(() => setCount(count + 1), msPerChar);
    return () => clearTimeout(timer);
  }, [active, count, text, msPerChar]);
  if (reduced) return text;
  return text.slice(0, count);
}

function Cursor({ x, y, clicking }: { x: string | number; y: string | number; clicking?: boolean }) {
  return (
    <div
      className="pointer-events-none absolute z-30 transition-[left,top] duration-[650ms]"
      style={{ left: x, top: y, transitionTimingFunction: 'cubic-bezier(0.45, 0, 0.2, 1)' }}
      aria-hidden="true"
    >
      {clicking && (
        <span className="animate-click absolute -top-3 -left-3 size-6 rounded-full border-2 border-focus bg-focus/20" />
      )}
      <svg
        width="16"
        height="20"
        viewBox="0 0 16 20"
        className={cx('origin-top-left drop-shadow-md transition-transform duration-150', clicking && 'scale-[0.82]')}
      >
        <path
          d="M1.5 1.5 L1.5 15.5 L5.2 12 L8 18.4 L10.4 17.3 L7.7 11 L12.8 11 Z"
          fill="white"
          stroke="#161615"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function Caret() {
  return <span className="ml-px inline-block h-3.5 w-px translate-y-0.5 animate-pulse bg-ink" />;
}

/** The stage every demo plays on. */
function Stage({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="animate-rise relative h-[258px] overflow-hidden rounded-xl border border-line bg-subtle select-none"
    >
      {children}
    </div>
  );
}

function BrowserBar({ address, children }: { address: string; children?: ReactNode }) {
  return (
    <div className="absolute inset-x-0 top-0 flex h-10 items-center gap-2 border-b border-line bg-surface px-3">
      <span className="flex gap-1" aria-hidden="true">
        <span className="size-2 rounded-full bg-line-strong" />
        <span className="size-2 rounded-full bg-line-strong" />
        <span className="size-2 rounded-full bg-line-strong" />
      </span>
      <span className="ml-2 h-6 flex-1 truncate rounded-full bg-subtle px-3 text-[11px] leading-6 text-ink-3">{address}</span>
      {children}
    </div>
  );
}

// ── Step 1: OmniMemory in the middle, memories flowing to each chatbot ─────

const HUB_PATHS: [SiteId, string][] = [
  ['chatgpt', 'M144 64 L44 24'],
  ['claude', 'M144 64 L244 24'],
  ['gemini', 'M144 64 L144 112'],
];

const HUB_NOTES = ['I’m vegetarian', 'Keep answers short', 'I live in Seattle', 'I prefer metric units'];

export function HubDemo() {
  const reduced = useReducedMotion();
  const phase = useTimeline([1600, 1600, 1600, 1600]);
  return (
    <div className="relative mx-auto my-2 h-40 w-72" aria-hidden="true">
      <span
        key={phase}
        className="animate-pop absolute -top-1 left-1/2 -translate-x-1/2 rounded-full border border-line bg-surface px-2.5 py-0.5 text-[11px] whitespace-nowrap text-ink-2 shadow-pop"
      >
        “{HUB_NOTES[phase]}”
      </span>
      <svg className="absolute inset-x-0 top-6 text-line-strong" viewBox="0 0 288 128" fill="none">
        {HUB_PATHS.map(([site, d], index) => (
          <g key={site}>
            <path d={d} stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 4" />
            {!reduced &&
              [0, 0.12, 0.24].map((lag, trail) => (
                <circle key={trail} r={3.5 - trail} style={{ fill: SITES[site].color }} opacity={1 - trail * 0.35}>
                  <animateMotion
                    dur="1.8s"
                    begin={`${index * 0.3 + lag}s`}
                    repeatCount="indefinite"
                    path={d}
                    keyPoints="0;1"
                    keyTimes="0;1"
                    calcMode="spline"
                    keySplines="0.4 0 0.2 1"
                  />
                </circle>
              ))}
          </g>
        ))}
      </svg>
      <div className="absolute top-[88px] left-1/2 -translate-x-1/2 -translate-y-1/2">
        {!reduced && <span className="animate-glow absolute inset-0 rounded-2xl bg-ink/20" aria-hidden="true" />}
        <div className="relative rounded-2xl bg-surface p-1.5 shadow-pop">
          <Logo size={40} />
        </div>
      </div>
      {(
        [
          ['chatgpt', 'top-7 left-0'],
          ['claude', 'top-7 right-0'],
          ['gemini', 'bottom-0 left-1/2 -translate-x-1/2'],
        ] as [SiteId, string][]
      ).map(([site, position]) => (
        <span
          key={site}
          className={cx(
            'absolute flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium',
            position,
          )}
        >
          <span className="size-2 rounded-full" style={{ background: SITES[site].color }} />
          {SITES[site].label}
        </span>
      ))}
    </div>
  );
}

// ── Step 2a: add from the toolbar ──────────────────────────────────────────

function ToolbarScene({ onDone }: { onDone?: () => void }) {
  //               idle  move  click popup+type  move  click saved
  const phase = useTimeline([700, 700, 350, 1900, 650, 350, 1700], onDone);
  const typed = useTyped('I prefer metric units', phase >= 3);
  const open = phase >= 3;
  const saved = phase >= 6;
  const cursor =
    phase === 0 ? { x: '45%', y: 130 } : phase <= 3 ? { x: 'calc(100% - 26px)', y: 18 } : { x: 'calc(100% - 52px)', y: 150 };
  return (
    <Stage label="Clicking the OmniMemory toolbar icon, typing a note and saving it">
      <BrowserBar address="any website">
        <span className="size-4 rounded bg-line-strong" aria-hidden="true" />
        <span className={cx('rounded p-0.5 transition-colors', phase >= 2 && 'bg-muted')}>
          <Logo size={18} />
        </span>
      </BrowserBar>
      <div className="absolute top-16 left-6 space-y-2.5" aria-hidden="true">
        <div className="h-3 w-48 rounded bg-line" />
        <div className="h-2 w-64 rounded bg-line/70" />
        <div className="h-2 w-56 rounded bg-line/70" />
        <div className="h-2 w-60 rounded bg-line/70" />
      </div>
      {open && (
        <div className="animate-pop absolute top-11 right-3 w-[236px] rounded-lg border border-line bg-surface p-3 shadow-pop">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <Logo size={14} /> OmniMemory
          </div>
          {saved ? (
            <div className="animate-pop flex h-[94px] flex-col items-center justify-center gap-1.5 text-center">
              <span className="flex size-7 items-center justify-center rounded-full bg-ok-soft text-ok">
                <Check size={15} />
              </span>
              <p className="text-xs font-medium">Memory saved</p>
              <p className="text-[11px] text-ink-3">Shared with ChatGPT, Claude and Gemini</p>
            </div>
          ) : (
            <>
              <div className="mt-2 h-14 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs">
                {typed}
                {phase === 3 && <Caret />}
              </div>
              <div className="mt-2 flex items-center gap-1">
                {SITE_ORDER.map((site) => (
                  <span key={site} className="size-2.5 rounded-full" style={{ background: SITES[site].color }} />
                ))}
                <span
                  className={cx(
                    'ml-auto rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-fg transition-transform',
                    phase === 5 && 'scale-95',
                  )}
                >
                  Save
                </span>
              </div>
            </>
          )}
        </div>
      )}
      <Cursor {...cursor} clicking={phase === 2 || phase === 5} />
    </Stage>
  );
}

// ── Step 2b: save from any page ────────────────────────────────────────────

const SELECTED = 'I’m training for a half marathon in March.';

function PageScene({ onDone }: { onDone?: () => void }) {
  //               start select right menu  click review move  click saved
  const phase = useTimeline([600, 1000, 350, 700, 350, 1600, 650, 350, 1500], onDone);
  const menu = phase >= 2 && phase <= 4;
  const review = phase >= 5;
  const saved = phase >= 8;
  const cursor =
    phase === 0
      ? { x: 22, y: 98 }
      : phase <= 2
        ? { x: 292, y: 100 }
        : phase <= 4
          ? { x: 360, y: 184 }
          : { x: 'calc(100% - 52px)', y: 156 };
  return (
    <Stage label="Selecting a sentence on a web page, right-clicking and saving it to OmniMemory">
      <BrowserBar address="myrunningblog.com/spring-plans" />
      <div className="absolute top-14 left-6 w-[300px]">
        <p className="text-sm font-semibold">Spring plans</p>
        <p className="mt-2 text-xs text-ink-2">Here’s what the next few months look like.</p>
        <p className="mt-1 text-xs">
          <span
            className="rounded-sm transition-[background-size] duration-1000 ease-linear"
            style={{
              backgroundImage: 'linear-gradient(color-mix(in srgb, var(--om-focus) 30%, transparent), color-mix(in srgb, var(--om-focus) 30%, transparent))',
              backgroundRepeat: 'no-repeat',
              backgroundSize: phase >= 1 ? '100% 100%' : '0% 100%',
            }}
          >
            {SELECTED}
          </span>
        </p>
        <div className="mt-3 space-y-2" aria-hidden="true">
          <div className="h-2 w-64 rounded bg-line/70" />
          <div className="h-2 w-52 rounded bg-line/70" />
        </div>
      </div>
      {menu && (
        <div className="animate-pop absolute top-[110px] left-[300px] w-56 rounded-md border border-line bg-surface py-1 text-[11px] shadow-pop">
          <p className="px-3 py-1.5 text-ink-2">Copy</p>
          <p className="truncate px-3 py-1.5 text-ink-2">Search for “I’m training for a half…”</p>
          <div className="my-1 border-t border-line" />
          <p className={cx('flex items-center gap-1.5 px-3 py-1.5 transition-colors', phase >= 3 && 'bg-muted')}>
            <Logo size={12} /> Save selection to OmniMemory…
          </p>
        </div>
      )}
      {review && (
        <div className="animate-pop absolute top-12 right-3 w-[236px] rounded-lg border border-line bg-surface p-3 shadow-pop">
          {saved ? (
            <div className="animate-pop flex h-[104px] flex-col items-center justify-center gap-1.5 text-center">
              <span className="flex size-7 items-center justify-center rounded-full bg-ok-soft text-ok">
                <Check size={15} />
              </span>
              <p className="text-xs font-medium">Saved to OmniMemory</p>
            </div>
          ) : (
            <>
              <p className="text-xs font-semibold">Review before saving</p>
              <p className="mt-2 rounded-md border border-line-strong px-2 py-1.5 text-xs">{SELECTED}</p>
              <div className="mt-2 flex items-center gap-1">
                {SITE_ORDER.map((site) => (
                  <span key={site} className="size-2.5 rounded-full" style={{ background: SITES[site].color }} />
                ))}
                <span className="ml-auto rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-fg">
                  Save
                </span>
              </div>
            </>
          )}
        </div>
      )}
      <Cursor {...cursor} clicking={phase === 2 || phase === 4 || phase === 7} />
    </Stage>
  );
}

// ── Step 2c: insert into a chat ────────────────────────────────────────────

const SUGGESTED = [
  { text: 'I’m vegetarian', on: true },
  { text: 'I cook for a family of four', on: true },
  { text: 'I prefer metric units', on: false },
];

function ChatScene({ onDone }: { onDone?: () => void }) {
  //               type  move  click panel move click inserted
  const phase = useTimeline([1600, 650, 350, 1300, 650, 350, 2600], onDone);
  const typed = useTyped('Help me plan easy dinners for this week', true);
  const panel = phase >= 3 && phase <= 5;
  const inserted = phase >= 6;
  const cursor =
    phase === 0 ? { x: '60%', y: 80 } : phase <= 3 ? { x: 52, y: 216 } : phase <= 5 ? { x: 270, y: 144 } : { x: '60%', y: 90 };
  return (
    <Stage label="Pressing the OmniMemory button in a chat and inserting suggested memories into the message">
      <div className="absolute inset-x-0 top-0 flex h-10 items-center gap-2 border-b border-line bg-surface px-3 text-xs">
        <span className="font-medium">New chat</span>
        <span className="ml-auto flex items-center gap-1 text-[11px] text-ink-3">
          {SITE_ORDER.map((site) => (
            <span key={site} className="size-2 rounded-full" style={{ background: SITES[site].color }} />
          ))}
          <span className="ml-1">Same on ChatGPT, Claude and Gemini</span>
        </span>
      </div>
      {!inserted && <p className="absolute top-[80px] w-full text-center text-sm text-ink-3">How can I help?</p>}
      {inserted && (
        <span className="animate-pop absolute top-12 right-3 rounded-full bg-ok-soft px-2 py-0.5 text-[11px] text-ok">
          Nothing is sent until you press send
        </span>
      )}
      {panel && (
        <div className="animate-pop absolute bottom-[90px] left-4 w-[300px] rounded-lg border border-line bg-surface p-2 shadow-pop">
          <p className="px-1 text-[11px] font-semibold text-ink-2">Suggested for this message</p>
          <ul className="mt-1">
            {SUGGESTED.map((item) => (
              <li key={item.text} className="flex items-center gap-2 rounded px-1 py-1 text-[11px]">
                <span
                  className={cx(
                    'flex size-3 items-center justify-center rounded-sm border',
                    item.on ? 'border-accent bg-accent text-accent-fg' : 'border-line-strong',
                  )}
                >
                  {item.on && <Check size={9} strokeWidth={3} />}
                </span>
                <span className={item.on ? '' : 'text-ink-3'}>{item.text}</span>
              </li>
            ))}
          </ul>
          <div className="mt-1 flex justify-end">
            <span
              className={cx(
                'rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-fg transition-opacity',
                phase === 5 && 'scale-95',
              )}
            >
              Insert 2
            </span>
          </div>
        </div>
      )}
      <div className="absolute inset-x-4 bottom-4 rounded-xl border border-line-strong bg-surface p-2.5">
        {inserted && (
          <div className="animate-pop mb-1.5 rounded-md border border-line bg-subtle px-2 py-1 text-[11px] leading-relaxed text-ink-2">
            <p className="font-medium text-ink">Context from OmniMemory:</p>
            <p>• I’m vegetarian</p>
            <p>• I cook for a family of four</p>
          </div>
        )}
        <p className="min-h-5 text-xs">
          {typed}
          {phase === 0 && <Caret />}
        </p>
        <div className="mt-2 flex items-center">
          <span
            className={cx(
              'flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] font-medium transition-colors',
              phase >= 2 && phase <= 5 && 'bg-muted',
            )}
          >
            <Logo size={13} /> Memory
          </span>
          <span className="ml-auto flex size-6 items-center justify-center rounded-full bg-accent text-accent-fg">
            <Send size={11} />
          </span>
        </div>
      </div>
      <Cursor {...cursor} clicking={phase === 2 || phase === 5} />
    </Stage>
  );
}

const SCENES = [
  {
    tab: 'Toolbar',
    total: 6350,
    Scene: ToolbarScene,
    caption: 'Click the OmniMemory icon in Chrome’s toolbar, type a note and save. Pin the icon so it’s one click away.',
  },
  {
    tab: 'Any page',
    total: 7100,
    Scene: PageScene,
    caption: 'Select text on any page, right-click and choose “Save selection to OmniMemory”. You check it before it’s saved.',
  },
  {
    tab: 'In a chat',
    total: 7500,
    Scene: ChatScene,
    caption: 'Next to the message box, the OmniMemory button suggests memories that fit what you’re typing and adds them.',
  },
];

/** The three ways in, played one after another. Click a tab to jump. */
export function SavingDemos() {
  const [index, setIndex] = useState(0);
  const [round, setRound] = useState(0);
  const current = SCENES[index];
  const next = () => {
    setIndex((value) => (value + 1) % SCENES.length);
    setRound((value) => value + 1);
  };
  return (
    <div>
      <div className="mb-2 flex gap-1" role="tablist" aria-label="Ways to use OmniMemory">
        {SCENES.map((scene, tab) => (
          <button
            key={scene.tab}
            type="button"
            role="tab"
            aria-selected={tab === index}
            onClick={() => {
              setIndex(tab);
              setRound((value) => value + 1);
            }}
            className={cx(
              'relative flex-1 overflow-hidden rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
              tab === index ? 'bg-muted text-ink' : 'text-ink-3 hover:bg-subtle hover:text-ink-2',
            )}
          >
            {scene.tab}
            {tab === index && (
              <span
                key={round}
                className="absolute bottom-0 left-0 h-0.5 bg-ink/60"
                style={{ animation: `om-progress ${scene.total}ms linear forwards` }}
              />
            )}
          </button>
        ))}
      </div>
      <current.Scene key={round} onDone={next} />
      <p className="mt-2.5 text-xs leading-relaxed text-ink-2">{current.caption}</p>
    </div>
  );
}
