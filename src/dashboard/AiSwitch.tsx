import { Sparkles } from 'lucide-react';
import { SHARED_DAILY_LIMIT } from '../core';
import { HAS_SHARED_KEY } from '../shared/platform';
import { Toggle } from '../ui/components/primitives';
import type { Store } from '../ui/hooks/useStore';

/**
 * Turn the AI features on or off right where they're explained (the welcome
 * tour and the dashboard walkthrough), with what turning them on means.
 */
export function AiSwitch({ store }: { store: Store }) {
  const { service, settings } = store;
  if (!HAS_SHARED_KEY && !settings.aiEnabled) {
    return (
      <p className="text-[11.5px] leading-relaxed text-ink-3">
        To use the AI features, add your own Gemini API key in Settings → AI assistant.
      </p>
    );
  }
  return (
    <div className="rounded-lg border border-line px-3 py-2.5">
      <label className="flex items-center gap-3">
        <Sparkles size={14} className="shrink-0 text-ink-2" />
        <span className="flex-1 text-[13px] font-medium">Use AI features</span>
        <Toggle
          label="Use AI features"
          checked={settings.aiEnabled}
          onChange={(aiEnabled) => void service.updateSettings({ aiEnabled })}
        />
      </label>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-3">
        The Assistant, smarter repeat checks, tidying what chatbots remember, and picking the memories that fit what
        you’re typing on a chatbot. Memories you share with chatbots, and what you type there while suggestions are on,
        are sent to Google’s Gemini; private memories never are.
        {HAS_SHARED_KEY ? ` ${SHARED_DAILY_LIMIT} free AI actions a day, or unlimited with your own key.` : ''}
      </p>
    </div>
  );
}
