import { useState, type ReactNode } from 'react';
import { Download, Monitor, Moon, Sun, Upload } from 'lucide-react';
import { DEFAULT_SITE_COLORS, buildExport, exportFileName, type SiteId, type ThemeSetting } from '../core';
import { SITE_LIST } from '../shared/sites';
import { ConfirmDialog } from '../ui/components/Dialog';
import { Button, Toggle } from '../ui/components/primitives';
import { useToast } from '../ui/components/Toast';
import { cx, plural } from '../ui/format';
import type { Store } from '../ui/hooks/useStore';
import { SHARED_DAILY_LIMIT } from '../core';
import { HAS_SHARED_KEY } from '../shared/platform';
import { AiSettings } from './AiSettings';
import { ImportDialog } from './ImportDialog';
import { Help, type HelpId } from './help';

function Section({
  title,
  description,
  padded,
  help,
  children,
}: {
  title: string;
  description?: string;
  help?: HelpId;
  /** For content that isn't a list of rows. */
  padded?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="mt-7">
      <h2 className="flex items-center gap-1.5 text-[15px] font-semibold">
        {title}
        {help && <Help id={help} />}
      </h2>
      {description && <p className="mt-1 max-w-[640px] text-[12.5px] leading-relaxed text-ink-3">{description}</p>}
      <div
        className={cx(
          'mt-2.5 rounded-[14px] border border-line bg-surface',
          padded ? 'space-y-3 p-4' : 'divide-y divide-line',
        )}
      >
        {children}
      </div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
      <div className="min-w-[200px] flex-1">
        <p className="text-[13.5px] font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-3">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

/** Colours offered for each chatbot; any other colour can be picked too. */
const PALETTE = ['#3e9a7a', '#c4774f', '#8a70cc', '#3b5bdb', '#d14d72', '#c99a1f', '#2f8fb8', '#e0662f', '#6b8e23', '#5f5e59'];

function ColorRow({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string;
  fallback: string;
  onChange: (color: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3.5">
      <div className="flex min-w-[140px] flex-1 items-center gap-2.5">
        <span className="size-3 rounded-full" style={{ background: value }} aria-hidden="true" />
        <p className="text-[13.5px] font-medium">{label}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={`${label} colour`}>
        {PALETTE.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={value === color}
            aria-label={color}
            title={color}
            onClick={() => onChange(color)}
            className={cx(
              'size-[22px] rounded-full ring-offset-2 ring-offset-surface transition-shadow',
              value === color ? 'ring-2 ring-ink' : 'hover:ring-2 hover:ring-line-strong',
            )}
            style={{ background: color }}
          />
        ))}
        <label
          className="relative ml-1 inline-flex h-[26px] cursor-pointer items-center gap-1.5 rounded-lg border border-line-strong px-2 text-xs font-medium text-ink-2 hover:bg-subtle"
          title="Pick any colour"
        >
          Custom
          <input
            type="color"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-label={`Pick any colour for ${label}`}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
        {value !== fallback && (
          <button type="button" onClick={() => onChange(null)} className="ml-1 text-xs font-medium text-brand hover:underline">
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

const THEMES: { value: ThemeSetting; label: string; icon: ReactNode }[] = [
  { value: 'system', label: 'System', icon: <Monitor size={13} /> },
  { value: 'light', label: 'Light', icon: <Sun size={13} /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={13} /> },
];

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SettingsView({ store }: { store: Store }) {
  const { service, settings, library, trash } = store;
  const toast = useToast();
  const [importing, setImporting] = useState(false);
  const [includeTrash, setIncludeTrash] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);

  function exportAll() {
    const file = buildExport([...library, ...trash], { includeTrash });
    download(exportFileName(), JSON.stringify(file, null, 2));
    toast(`Exported ${plural(file.count, 'memory', 'memories')}`);
  }

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[760px] px-10 pb-16 max-md:px-5">
        <header className="pt-8">
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Settings</h1>
        </header>

        <Section
          title="Sharing"
          help="settings.sharing"
          description="These switches sit above each memory’s own sharing toggles. Pausing never deletes or changes a memory — it only stops chatbots from receiving anything until you resume."
        >
          <Row label="Pause all sharing" hint="No chatbot receives any memory while this is on.">
            <Toggle
              label="Pause all sharing"
              checked={settings.sharingPaused}
              onChange={(sharingPaused) => void service.updateSettings({ sharingPaused })}
            />
          </Row>
          {SITE_LIST.map((site) => (
            <Row
              key={site.id}
              label={`Share with ${site.label}`}
              hint={`Turn off to stop memory retrieval on ${site.hosts[0]} only.`}
            >
              <Toggle
                label={`Share with ${site.label}`}
                disabled={settings.sharingPaused}
                checked={!settings.sitePaused[site.id]}
                onChange={(on) =>
                  void service.updateSettings({ sitePaused: { [site.id]: !on } as Record<SiteId, boolean> })
                }
              />
            </Row>
          ))}
        </Section>

        <Section
          title="New memories"
          help="settings.new"
          description="Who a memory is shared with when you first save it. You can change this per memory at any time. If sync is on for a chatbot, sharing a memory with it also writes it to that chatbot’s own memory settings."
        >
          {SITE_LIST.map((site) => (
            <Row key={site.id} label={`Share new memories with ${site.label}`}>
              <Toggle
                label={`Share new memories with ${site.label}`}
                checked={settings.defaultPermissions[site.id]}
                onChange={(on) =>
                  void service.updateSettings({
                    defaultPermissions: { [site.id]: on } as Record<SiteId, boolean>,
                  })
                }
              />
            </Row>
          ))}
        </Section>

        <Section
          title="Memories saved on a chatbot"
          help="settings.source"
          description="Things you save from the in-chat panel (or bring in from a chatbot) can follow different rules. For example, memories saved on ChatGPT can stay off Claude. The panel shows these choices each time you save, so you can still change them."
        >
          {SITE_LIST.map((source) => {
            const own = settings.sourceDefaults[source.id];
            const effective = own ?? settings.defaultPermissions;
            return (
              <Row
                key={source.id}
                label={`Saved on ${source.label}`}
                hint={own ? 'Its own rule.' : 'Follows “New memories” above.'}
              >
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`Share memories saved on ${source.label} with`}>
                  {SITE_LIST.map((target) => (
                    <button
                      key={target.id}
                      type="button"
                      aria-pressed={effective[target.id]}
                      onClick={() =>
                        void service.updateSettings({
                          sourceDefaults: { [source.id]: { ...effective, [target.id]: !effective[target.id] } },
                        })
                      }
                      className={cx(
                        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors',
                        effective[target.id]
                          ? 'border-brand bg-brand-soft text-brand'
                          : 'border-line-strong text-ink-3 hover:text-ink-2',
                      )}
                    >
                      <span className="size-1.5 rounded-full" style={{ background: target.color }} />
                      {target.label}
                    </button>
                  ))}
                  {own && (
                    <button
                      type="button"
                      className="ml-1 text-[12px] font-medium text-ink-3 underline-offset-2 hover:text-ink hover:underline"
                      onClick={() => void service.updateSettings({ sourceDefaults: { [source.id]: null } })}
                    >
                      Reset
                    </button>
                  )}
                </div>
              </Row>
            );
          })}
        </Section>

        <Section title="Suggestions">
          <Row
            label="Suggest memories that fit the conversation"
            hint="On a chatbot page, OmniMemory reads what you’re typing and the last few visible messages, and shows the memories that fit beside the Memory button and at the top of the panel. That text is never stored. Turn off to list memories by when you last used them."
          >
            <Toggle
              label="Suggest memories that fit the conversation"
              checked={settings.relevanceFromPage}
              onChange={(relevanceFromPage) => void service.updateSettings({ relevanceFromPage })}
            />
          </Row>
          {settings.aiEnabled && settings.relevanceFromPage && (
            <Row
              label="Pick them with AI"
              hint="Sends what you’re typing, the last few messages and the memories you share with that chatbot to Google’s Gemini, which picks the ones that would help. Much better than matching words. Off: matching words, on this device only."
            >
              <Toggle
                label="Pick suggestions with AI"
                checked={settings.aiMatching}
                onChange={(aiMatching) => void service.updateSettings({ aiMatching })}
              />
            </Row>
          )}
        </Section>

        <Section
          title="Appearance"
          help="settings.appearance"
          description="Each chatbot’s colour is used for its dots, bars and badges across the dashboard, the toolbar popup and the memory bar on chatbot sites."
        >
          <Row label="Theme" hint="Light, dark, or match your computer. The memory bar on chatbot sites follows the site’s own theme.">
            <div className="inline-flex rounded-[9px] bg-muted p-[3px]" role="radiogroup" aria-label="Theme">
              {THEMES.map((theme) => (
                <button
                  key={theme.value}
                  type="button"
                  role="radio"
                  aria-checked={settings.theme === theme.value}
                  onClick={() => void service.updateSettings({ theme: theme.value })}
                  className={cx(
                    'inline-flex h-7 items-center gap-1.5 rounded-[7px] px-3 text-[12.5px] font-medium transition-colors',
                    settings.theme === theme.value ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink',
                  )}
                >
                  {theme.icon}
                  {theme.label}
                </button>
              ))}
            </div>
          </Row>
          {SITE_LIST.map((site) => (
            <ColorRow
              key={site.id}
              label={site.label}
              value={settings.siteColors[site.id]}
              fallback={DEFAULT_SITE_COLORS[site.id]}
              onChange={(color) => void service.updateSettings({ siteColors: { [site.id]: color } })}
            />
          ))}
        </Section>

        <Section
          title="Your data"
          description="Memories are stored in this browser profile, on this device. They are not uploaded to any OmniMemory server and do not sync between devices or browsers. With chatbot memory sync on, the ones you share with ChatGPT or Gemini are also written to that chatbot’s own memory. Removing the extension erases OmniMemory’s copy — export first if you want one."
        >
          <Row
            label="Export memories"
            hint={`A JSON file with ${plural(library.length, 'memory', 'memories')}${includeTrash ? ` plus ${trash.length} in Recently Deleted` : ''}.`}
          >
            <label className="flex items-center gap-1.5 text-xs text-ink-2">
              <input
                type="checkbox"
                className="accent-(--om-brand)"
                checked={includeTrash}
                onChange={(event) => setIncludeTrash(event.target.checked)}
              />
              Include Recently Deleted
            </label>
            <Button icon={<Download size={14} />} onClick={exportAll}>
              Export
            </Button>
          </Row>
          <Row label="Import memories" hint="From an OmniMemory export, a JSON list, or pasted text. You review everything first.">
            <Button icon={<Upload size={14} />} onClick={() => setImporting(true)}>
              Import…
            </Button>
          </Row>
          <Row label="Delete all memories" hint="Moves every memory to Recently Deleted, where it can be restored for 30 days.">
            <Button variant="dangerOutline" disabled={library.length === 0} onClick={() => setDeletingAll(true)}>
              Delete all…
            </Button>
          </Row>
        </Section>

        <Section title="Chatbot sync" description="Turn sync on or off for each chatbot on the Chatbots page.">
          <Row
            label="Sync in the background"
            hint="When a chatbot isn’t open, briefly open it in a background tab to write your changes, then close it. Turn off to sync only when you visit the chatbot yourself."
          >
            <Toggle
              label="Sync in the background"
              checked={settings.syncInBackground}
              onChange={(syncInBackground) => void service.updateSettings({ syncInBackground })}
            />
          </Row>
        </Section>

        <Section
          title="AI assistant"
          padded
          description={
            HAS_SHARED_KEY
              ? `Optional and off until you turn it on. ${SHARED_DAILY_LIMIT} free AI actions a day, or unlimited with your own Gemini key.`
              : 'Optional. Off unless you add your own Gemini API key.'
          }
        >
          <AiSettings store={store} />
        </Section>

        <Section title="Privacy" padded>
          <ul className="list-disc space-y-1.5 pl-4 text-[12.5px] leading-relaxed text-ink-2">
            <li>
              There is no OmniMemory account, server, analytics or telemetry. The only network requests are
              chatbot memory sync, which talks to ChatGPT, Claude and Gemini themselves, with your normal
              sign-in on those sites (you can turn it off per chatbot under Chatbots), and, only if you
              turn on the AI assistant, requests to Google’s Gemini API with your own key.
            </li>
            <li>
              Chatbot pages can only receive memories you have shared with that chatbot, and only when you
              press Insert or Copy. Nothing is sent or inserted automatically.
            </li>
            <li>
              With sync on, memories shared with a chatbot are written to that chatbot’s own memory
              (Gemini’s Instructions, ChatGPT’s custom instructions, Claude’s Instructions), and removed again when you delete
              or stop sharing them.
            </li>
            <li>Text that looks like a password, key or card number is refused when saving from a page.</li>
          </ul>
        </Section>

        <Section title="Help">
          <Row label="Welcome tour" hint="A short intro to saving memories and chatbot sync, then a look around.">
            <Button size="sm" onClick={() => (window.location.hash = '/welcome')}>
              Take the tour again
            </Button>
          </Row>
          <Row label="Dashboard walkthrough" hint="Popups that point at each part of the dashboard and say what it’s for.">
            <Button size="sm" onClick={() => (window.location.hash = '/walkthrough')}>
              Show me around
            </Button>
          </Row>
        </Section>
      </div>

      <ImportDialog open={importing} library={library} service={service} onClose={() => setImporting(false)} />

      <ConfirmDialog
        open={deletingAll}
        title={`Delete all ${plural(library.length, 'memory', 'memories')}?`}
        confirmLabel="Move all to Recently Deleted"
        danger
        onCancel={() => setDeletingAll(false)}
        onConfirm={() =>
          void service.remove(library.map((m) => m.id)).then(() => {
            setDeletingAll(false);
            toast('All memories moved to Recently Deleted');
          })
        }
      >
        <p>
          Every memory stops being shared immediately. You can restore them from Recently Deleted for 30
          days.
        </p>
      </ConfirmDialog>
    </div>
  );
}
