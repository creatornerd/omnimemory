import { useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, HardDrive, PauseCircle, Plus, RefreshCw, ShieldCheck, Sparkles, Undo2 } from 'lucide-react';
import { SHARED_DAILY_LIMIT, SITE_IDS, SYNC_MODES, SYNC_TARGETS, type SiteId } from '../core';
import { HAS_SHARED_KEY } from '../shared/platform';
import { SITES } from '../shared/sites';
import { Dialog } from '../ui/components/Dialog';
import { Button, Toggle } from '../ui/components/primitives';
import { useToast } from '../ui/components/Toast';
import { cx } from '../ui/format';
import type { Store } from '../ui/hooks/useStore';
import { requestSync } from './sync-actions';
import { AssistantDemo, HubDemo, SavingDemos, SharingDemo, SyncDemo } from './tour-demos';

function Point({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-subtle text-ink-2">{icon}</span>
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{children}</p>
      </div>
    </li>
  );
}

function SyncChoices({ store }: { store: Store }) {
  const { service, settings } = store;
  const toast = useToast();
  const sites = SITE_IDS.filter((site) => SYNC_MODES[site] !== null);

  async function set(site: SiteId, on: boolean) {
    await service.updateSettings({ siteSync: { [site]: on } });
    if (!on) return;
    try {
      await requestSync(site);
      toast(`Checking ${SITES[site].label}. Nothing is written until you OK it.`);
    } catch (error) {
      toast((error as Error).message);
    }
  }

  const allOn = sites.every((site) => settings.siteSync[site]);

  /** One settings change for every chatbot, then a check on each. */
  async function turnOnAll() {
    const off = sites.filter((site) => !settings.siteSync[site]);
    if (off.length === 0) return;
    await service.updateSettings({ siteSync: Object.fromEntries(off.map((site) => [site, true])) });
    const results = await Promise.allSettled(off.map((site) => requestSync(site)));
    const failed = results.find((result) => result.status === 'rejected');
    toast(
      failed
        ? (failed.reason as Error).message
        : `Checking ${off.map((site) => SITES[site].label).join(', ')}. Nothing is written until you OK it.`,
    );
  }

  return (
    <div>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {sites.map((site) => (
          <li key={site} className="flex items-center gap-3 px-3 py-2.5">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: SITES[site].color }} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">{SITES[site].label}</p>
              <p className="truncate text-[11px] text-ink-3">Writes to {SYNC_TARGETS[site]}</p>
            </div>
            <Toggle
              label={`Keep ${SITES[site].label}’s memory in sync`}
              checked={settings.siteSync[site]}
              onChange={(on) => void set(site, on)}
            />
          </li>
        ))}
      </ul>
      {!allOn && (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          icon={<RefreshCw size={12} />}
          onClick={() => void turnOnAll()}
        >
          Turn on for all
        </Button>
      )}
    </div>
  );
}

/** Turn the AI on right from the tour, when a key is available. */
function AiChoice({ store }: { store: Store }) {
  const { service, settings } = store;
  if (!HAS_SHARED_KEY) {
    return (
      <p className="mt-3 text-[11px] text-ink-3">Turn it on any time in Settings → AI assistant with your Gemini key.</p>
    );
  }
  return (
    <label className="mt-3 flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
      <Sparkles size={14} />
      <span className="flex-1 text-[13px] font-medium">Use the AI assistant</span>
      <Toggle
        label="Use the AI assistant"
        checked={settings.aiEnabled}
        onChange={(aiEnabled) => void service.updateSettings({ aiEnabled })}
      />
    </label>
  );
}

interface Step {
  title: string;
  body: (store: Store) => ReactNode;
}

const STEPS: Step[] = [
  {
    title: 'One memory for all your chatbots',
    body: () => (
      <>
        <HubDemo />
        <p className="text-[13px] leading-relaxed text-ink-2">
          Tell OmniMemory something once — your job, how you like answers, what you’re working on — and ChatGPT,
          Claude and Gemini can all use it. No more repeating yourself every time you switch.
        </p>
        <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
          By using OmniMemory you agree to its{' '}
          <a href="https://omnimemory.vercel.app/terms" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-ink">
            Terms of Use
          </a>{' '}
          and{' '}
          <a href="https://omnimemory.vercel.app/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-ink">
            Privacy Policy
          </a>
          .
        </p>
      </>
    ),
  },
  {
    title: 'Three ways to use it',
    body: () => <SavingDemos />,
  },
  {
    title: 'You decide who sees what',
    body: () => (
      <>
        <SharingDemo />
        <p className="mt-2.5 text-xs leading-relaxed text-ink-2">
          Every memory has a switch for each chatbot. Turn one off and that chatbot never gets it; mark it private and
          none of them do.
        </p>
        <ul className="mt-3 space-y-2.5">
          <Point icon={<HardDrive size={14} />} title="Stored on this device">
            No OmniMemory account or server. Nothing leaves this browser except to the chatbots you choose.
          </Point>
          <Point icon={<PauseCircle size={14} />} title="One switch to pause it all">
            “Sharing on” at the bottom of the sidebar stops every chatbot getting anything until you turn it back on.
          </Point>
        </ul>
      </>
    ),
  },
  {
    title: 'Let AI keep it tidy',
    body: (store) => (
      <>
        <AssistantDemo />
        <p className="mt-2.5 text-xs leading-relaxed text-ink-2">
          Ask the Assistant in plain words — “remove the repeats”, “I moved to Austin”, “what do you know about me?” — and
          it suggests the changes. Nothing changes until you press Apply, and Undo puts everything back.
        </p>
        <ul className="mt-3 space-y-2.5">
          <Point icon={<Sparkles size={14} />} title="Catches repeats and pulls in what matters">
            Warns before you save something you already have, tidies what your chatbots remember into one clean list,
            and the ✦ button on a chat suggests memories from it.
          </Point>
          <Point icon={<ShieldCheck size={14} />} title="Only what you’d expect">
            The AI never sees private memories, ones not shared with any chatbot, or ones you’ve switched off for AI.{' '}
            {HAS_SHARED_KEY
              ? `${SHARED_DAILY_LIMIT} free AI actions a day, or add your own Gemini key for unlimited use.`
              : 'It uses your own Gemini key.'}
          </Point>
        </ul>
        <AiChoice store={store} />
      </>
    ),
  },
  {
    title: 'Chatbot sync keeps their own memory up to date',
    body: () => (
      <>
        <SyncDemo />
        <p className="mt-2.5 text-xs leading-relaxed text-ink-2">
          With sync on, your memories are written into each chatbot’s own settings, so they’re there even when you
          don’t insert them. Edit a memory and the chatbot gets the new wording; change it on the chatbot and
          OmniMemory picks that up.
        </p>
        <ul className="mt-3 space-y-2.5">
          <Point icon={<ShieldCheck size={14} />} title="Nothing is written without your OK">
            You see what it would change first. One click approves everything for that chatbot.
          </Point>
          <Point icon={<Undo2 size={14} />} title="Every change can be undone">
            Chatbots in the sidebar lists what changed, with an undo button for each one.
          </Point>
        </ul>
      </>
    ),
  },
  {
    title: 'Turn on sync',
    body: (store) => (
      <>
        <p className="mb-3 text-[13px] leading-relaxed text-ink-2">
          Choose the chatbots to keep in sync. OmniMemory checks each one and shows you what it would write before
          writing anything.
        </p>
        <SyncChoices store={store} />
        <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
          Be signed in to each chatbot in this browser. You can change this any time under Chatbots.
        </p>
      </>
    ),
  },
  {
    title: 'You’re all set',
    body: (store) => {
      const syncing = SITE_IDS.filter((site) => store.settings.siteSync[site]);
      return (
        <div className="py-6 text-center">
          <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-ok-soft text-ok">
            <Sparkles size={20} />
          </span>
          <p className="mx-auto mt-3 max-w-sm text-[13px] leading-relaxed text-ink-2">
            Start by adding a few things you’d like every chatbot to know.
            {syncing.length > 0
              ? ` Then open Chatbots to see what OmniMemory plans to write to ${syncing.map((site) => SITES[site].label).join(', ')} and approve it.`
              : ' You can turn on syncing later under Chatbots.'}
          </p>
        </div>
      );
    },
  },
];

export function Welcome({
  open,
  store,
  onClose,
  onAddMemory,
}: {
  open: boolean;
  store: Store;
  onClose: () => void;
  onAddMemory: () => void;
}) {
  const [index, setIndexState] = useState(0);
  const [direction, setDirection] = useState<'next' | 'back'>('next');
  const setIndex = (next: number) => {
    setDirection(next >= index ? 'next' : 'back');
    setIndexState(next);
  };
  const step = STEPS[index];
  const last = index === STEPS.length - 1;

  function close() {
    setIndexState(0);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={`Welcome to OmniMemory · ${index + 1} of ${STEPS.length}`}
      width="lg"
      footer={
        <>
          <div className="mr-auto flex items-center gap-1.5" aria-hidden="true">
            {STEPS.map((_, dot) => (
              <button
                key={dot}
                type="button"
                tabIndex={-1}
                onClick={() => setIndex(dot)}
                className={cx('h-1.5 rounded-full transition-all', dot === index ? 'w-5 bg-ink' : 'w-1.5 bg-line-strong')}
              />
            ))}
          </div>
          {index === 0 ? (
            <Button variant="ghost" onClick={close}>
              Skip tour
            </Button>
          ) : (
            <Button icon={<ArrowLeft size={13} />} onClick={() => setIndex(index - 1)}>
              Back
            </Button>
          )}
          {last ? (
            <Button
              variant="primary"
              icon={<Plus size={13} />}
              onClick={() => {
                close();
                onAddMemory();
              }}
            >
              Add your first memory
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setIndex(index + 1)} data-autofocus>
              {index === 0 ? 'Show me how' : 'Next'} <ArrowRight size={13} />
            </Button>
          )}
        </>
      }
    >
      <div key={index} className={cx('min-h-[420px]', direction === 'next' ? 'animate-slide-next' : 'animate-slide-back')}>
        <h3 className="mb-3 text-base font-semibold">{step.title}</h3>
        {step.body(store)}
      </div>
    </Dialog>
  );
}
