import { useState, type ReactNode } from 'react';
import { Download, Monitor, Moon, Sun, Upload } from 'lucide-react';
import { buildExport, exportFileName, type SiteId, type ThemeSetting } from '../core';
import { SITE_LIST } from '../shared/sites';
import { ConfirmDialog } from '../ui/components/Dialog';
import { Button, Toggle } from '../ui/components/primitives';
import { useToast } from '../ui/components/Toast';
import { cx, plural } from '../ui/format';
import type { Store } from '../ui/hooks/useStore';
import { ImportDialog } from './ImportDialog';

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="border-b border-line py-6 last:border-b-0">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && <p className="mt-1 max-w-xl text-xs leading-relaxed text-ink-3">{description}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-[13px]">{label}</p>
        {hint && <p className="text-xs leading-relaxed text-ink-3">{hint}</p>}
      </div>
      {children}
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
      <div className="mx-auto max-w-2xl px-6 pb-10">
        <header className="pt-5">
          <h1 className="text-base font-semibold">Settings</h1>
        </header>

        <Section
          title="Sharing"
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

        <Section title="Suggestions">
          <Row
            label="Suggest memories that fit the conversation"
            hint="When you open the OmniMemory panel on a chatbot page, it reads your draft and the last few visible messages to rank your memories. That text is used once, on this device, and is never stored. Turn off to rank by recency only."
          >
            <Toggle
              label="Suggest memories that fit the conversation"
              checked={settings.relevanceFromPage}
              onChange={(relevanceFromPage) => void service.updateSettings({ relevanceFromPage })}
            />
          </Row>
        </Section>

        <Section title="Appearance">
          <Row label="Theme">
            <div className="flex rounded-md border border-line-strong p-px" role="radiogroup" aria-label="Theme">
              {THEMES.map((theme) => (
                <button
                  key={theme.value}
                  type="button"
                  role="radio"
                  aria-checked={settings.theme === theme.value}
                  onClick={() => void service.updateSettings({ theme: theme.value })}
                  className={cx(
                    'inline-flex h-[26px] items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-medium transition-colors',
                    settings.theme === theme.value ? 'bg-muted text-ink' : 'text-ink-3 hover:text-ink',
                  )}
                >
                  {theme.icon}
                  {theme.label}
                </button>
              ))}
            </div>
          </Row>
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
                className="accent-(--om-accent)"
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

        <Section title="Privacy">
          <ul className="max-w-xl list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-ink-2">
            <li>
              There is no OmniMemory account, server, analytics or telemetry. The only network requests are
              chatbot memory sync, which talks to ChatGPT and Gemini themselves, with your normal sign-in on
              those sites. You can turn it off per chatbot under Chatbot memory.
            </li>
            <li>
              Chatbot pages can only receive memories you have shared with that chatbot, and only when you
              press Insert or Copy. Nothing is sent or inserted automatically.
            </li>
            <li>
              With sync on, memories shared with a chatbot are written to that chatbot’s own memory
              (Gemini’s Instructions, ChatGPT’s custom instructions), and removed again when you delete
              or stop sharing them.
            </li>
            <li>Text that looks like a password, key or card number is refused when saving from a page.</li>
          </ul>
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
