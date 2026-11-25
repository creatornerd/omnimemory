import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, KeyRound, Sparkles } from 'lucide-react';
import { AI_MODEL_LABEL, CHAT_MODEL_LABEL, pingRequest } from '../core';
import { onChange } from '../shared/change-bus';
import { generateJson } from '../shared/gemini';
import { HAS_SHARED_KEY, aiKey, aiStatus, setSessionAiKey, type AiKeySource } from '../shared/platform';
import { Button, Notice, Toggle } from '../ui/components/primitives';
import { useToast } from '../ui/components/Toast';
import type { Store } from '../ui/hooks/useStore';

/** Settings → AI assistant: the on/off switch, today's shared allowance, and the user's own key. */
export function AiSettings({ store }: { store: Store }) {
  const { service, settings } = store;
  const toast = useToast();
  const [status, setStatus] = useState<{ source: AiKeySource | null; used: number; limit: number } | null>(null);
  const [ownTail, setOwnTail] = useState('');
  const [draft, setDraft] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = () =>
      void Promise.all([aiStatus(), aiKey()]).then(([next, resolved]) => {
        setStatus(next);
        setOwnTail(resolved && resolved.source !== 'shared' ? resolved.key.slice(-4) : '');
      });
    load();
    return onChange(load);
  }, [service]);

  const own = status?.source === 'device' || status?.source === 'session';

  async function test(key: string): Promise<boolean> {
    try {
      await generateJson(pingRequest(), key);
      return true;
    } catch (error) {
      toast((error as Error).message);
      return false;
    }
  }

  async function saveKey() {
    const key = draft.trim();
    if (!key) return;
    setBusy(true);
    try {
      if (!(await test(key))) return;
      if (remember) {
        await setSessionAiKey(null);
        await service.setAiKey(key);
      } else {
        await service.setAiKey(null);
        await setSessionAiKey(key);
      }
      setDraft('');
      if (!settings.aiEnabled) await service.updateSettings({ aiEnabled: true });
      toast(remember ? 'Key works and is saved. AI assistant is on.' : 'Key works. It’s kept until Chrome closes.');
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeKey() {
    await service.setAiKey(null);
    await setSessionAiKey(null);
    if (!HAS_SHARED_KEY) await service.updateSettings({ aiEnabled: false });
    toast(HAS_SHARED_KEY ? 'Your key is removed. The free daily allowance applies again.' : 'Key removed. AI assistant is off.');
  }

  const left = status ? Math.max(0, status.limit - status.used) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[13px]">
            <Sparkles size={13} /> Use AI to tidy and edit your memories
          </p>
          <p className="text-xs leading-relaxed text-ink-3">
            Spots repeats when you save, finds them in your library, tidies imports, suggests memories from a chat, and
            powers the Assistant page. Uses {AI_MODEL_LABEL} and {CHAT_MODEL_LABEL}.
          </p>
        </div>
        <Toggle
          label="Use AI to tidy and edit your memories"
          checked={settings.aiEnabled}
          disabled={!status?.source}
          onChange={(aiEnabled) => void service.updateSettings({ aiEnabled })}
        />
      </div>

      {status?.source === 'shared' && (
        <div className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-xs">
          <span className="flex-1">
            Free allowance: <strong>{left}</strong> of {status.limit} AI actions left today
          </span>
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className="h-full rounded-full bg-ink" style={{ width: `${(left / status.limit) * 100}%` }} />
          </div>
        </div>
      )}

      {own ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs">
          <CheckCircle2 size={14} className="text-ok" />
          <span className="flex-1">
            Your Gemini key <span className="font-mono text-ink-3">••••{ownTail}</span> ·{' '}
            {status?.source === 'session' ? 'kept until Chrome closes' : 'saved on this device'} · no daily limit
          </span>
          <Button size="sm" variant="ghost" onClick={() => void removeKey()}>
            Remove
          </Button>
        </div>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void saveKey();
          }}
        >
          <p className="text-xs text-ink-2">
            {HAS_SHARED_KEY ? 'For unlimited use, add your own Gemini API key:' : 'Add your Gemini API key to turn this on:'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <KeyRound size={13} className="pointer-events-none absolute top-2 left-2.5 text-ink-3" />
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Paste your Gemini API key"
                aria-label="Gemini API key"
                className="field h-8 pl-8 font-mono text-xs"
              />
            </div>
            <Button type="submit" variant="primary" size="sm" disabled={busy || !draft.trim()}>
              {busy ? 'Checking…' : 'Save key'}
            </Button>
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noreferrer noopener"
              className="flex items-center gap-1 text-xs text-ink-2 hover:text-ink"
            >
              Get a key <ExternalLink size={11} />
            </a>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-ink-2">
            <input
              type="checkbox"
              className="size-3.5 accent-[var(--om-accent)]"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            Remember on this device (untick to keep it only until Chrome closes)
          </label>
        </form>
      )}

      <Notice tone="info">
        <p>
          When the AI is used, the text involved is sent to Google’s Gemini API, and Google’s terms for that key apply
          (free keys may be used to improve Google’s products). It never sees private memories, memories not shared
          with any chatbot, memories you’ve switched off for AI (the ✦ switch on each memory), or anything that looks
          like a password.
        </p>
        <p className="mt-1.5">
          A saved key is stored unencrypted in this browser’s extension storage: chatbot pages can’t read it, but anyone
          with access to this Chrome profile could. Use a key limited to the Gemini API, or keep it until Chrome closes.
          Nothing the AI suggests is saved until you accept it.
        </p>
      </Notice>
    </div>
  );
}
