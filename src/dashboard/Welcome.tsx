import { useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react';
import { SITE_IDS, SYNC_MODES, SYNC_TARGETS, type SiteId } from '../core';
import { SITES } from '../shared/sites';
import { Dialog } from '../ui/components/Dialog';
import { Button, Toggle } from '../ui/components/primitives';
import { useToast } from '../ui/components/Toast';
import { cx } from '../ui/format';
import type { Store } from '../ui/hooks/useStore';
import { requestSync } from './sync-actions';
import { AiSwitch } from './AiSwitch';
import { HubDemo, SavingDemos } from './tour-demos';

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
    title: 'Choose what to turn on',
    body: (store) => (
      <>
        <h4 className="mb-1.5 text-[13px] font-semibold">Chatbot sync</h4>
        <p className="mb-3 text-[13px] leading-relaxed text-ink-2">
          Sync writes your memories into each chatbot’s own memory settings, so they’re there even when you don’t add
          them to a chat. OmniMemory checks each one and shows you what it would write before writing anything, and
          every change can be undone.
        </p>
        <SyncChoices store={store} />
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          Be signed in to each chatbot in this browser. You can change this any time under Chatbots.
        </p>
        <h4 className="mt-5 mb-1.5 text-[13px] font-semibold">AI features</h4>
        <AiSwitch store={store} />
        <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
          Both are optional and can be changed later. Next, a quick look around the dashboard.
        </p>
      </>
    ),
  },
];

export function Welcome({
  open,
  store,
  onClose,
  onFinish,
}: {
  open: boolean;
  store: Store;
  onClose: () => void;
  /** The last step was finished (not skipped): show the dashboard walkthrough. */
  onFinish: () => void;
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
              data-autofocus
              onClick={() => {
                close();
                onFinish();
              }}
            >
              Show me around <ArrowRight size={13} />
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setIndex(index + 1)} data-autofocus>
              {index === 0 ? 'Show me how' : 'Next'} <ArrowRight size={13} />
            </Button>
          )}
        </>
      }
    >
      <div key={index} className={cx('min-h-[360px]', direction === 'next' ? 'animate-slide-next' : 'animate-slide-back')}>
        <h3 className="mb-3 text-base font-semibold">{step.title}</h3>
        {step.body(store)}
      </div>
    </Dialog>
  );
}
