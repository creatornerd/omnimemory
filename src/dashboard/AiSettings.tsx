import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, KeyRound, Sparkles } from 'lucide-react';
import { AI_MODEL_LABEL, pingRequest } from '../core';
import { generateJson } from '../shared/gemini';
import { Button, Notice, Toggle } from '../ui/components/primitives';
import { useToast } from '../ui/components/Toast';
import type { Store } from '../ui/hooks/useStore';

/** Settings → AI assistant: the on/off switch and the user's own Gemini key. */
export function AiSettings({ store }: { store: Store }) {
  const { service, settings } = store;
  const toast = useToast();
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void service.getAiKey().then(setSavedKey);
  }, [service]);

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
      await service.setAiKey(key);
      setSavedKey(key);
      setDraft('');
      if (!settings.aiEnabled) await service.updateSettings({ aiEnabled: true });
      toast('Key works. AI assistant is on.');
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeKey() {
    await service.setAiKey(null);
    await service.updateSettings({ aiEnabled: false });
    setSavedKey(null);
    toast('Key removed. AI assistant is off.');
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[13px]">
            <Sparkles size={13} /> Use AI to spot repeats and tidy imports
          </p>
          <p className="text-xs leading-relaxed text-ink-3">
            Checks new memories for rewordings of ones you already have, finds repeats in your library, and turns what
            your chatbots remember into one clean list on the Review page. Uses {AI_MODEL_LABEL}.
          </p>
        </div>
        <Toggle
          label="Use AI to spot repeats and tidy imports"
          checked={settings.aiEnabled}
          disabled={!savedKey}
          onChange={(aiEnabled) => void service.updateSettings({ aiEnabled })}
        />
      </div>

      {savedKey ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs">
          <CheckCircle2 size={14} className="text-ok" />
          <span className="flex-1">
            Gemini API key saved <span className="font-mono text-ink-3">••••{savedKey.slice(-4)}</span>
          </span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void test(savedKey).then((ok) => ok && toast('Key works'))}>
            Test
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void removeKey()}>
            Remove
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void saveKey();
          }}
        >
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
        </form>
      )}

      <Notice tone="info">
        When this is on, the text of the memories involved is sent to Google’s Gemini API with your key, and Google’s
        terms for that key apply (free keys may be used to improve Google’s products). Private memories and anything
        that looks like a password are never sent. The key stays in this browser and is never shown to chatbot pages.
        Nothing the AI suggests is saved until you accept it.
      </Notice>
    </div>
  );
}
