import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bot, Inbox, Library as LibraryIcon, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { CATEGORIES, type Category } from '../core';
import { DASHBOARD_VIEWS, type DashboardView } from '../shared/messages';
import { takePendingCapture } from '../shared/platform';
import { MemoryForm } from '../ui/components/MemoryForm';
import { Dialog } from '../ui/components/Dialog';
import { Logo, Toggle } from '../ui/components/primitives';
import { useToast } from '../ui/components/Toast';
import { cx } from '../ui/format';
import { useStore } from '../ui/hooks/useStore';
import { useFound } from '../ui/hooks/useFound';
import { ChatbotsView } from './ChatbotsView';
import { ReviewView } from './ReviewView';
import { Library } from './Library';
import { SettingsView } from './SettingsView';
import { Trash } from './Trash';
import { Welcome } from './Welcome';

function viewFromHash(): DashboardView {
  const view = window.location.hash.replace(/^#\/?/, '');
  return (DASHBOARD_VIEWS as readonly string[]).includes(view) ? (view as DashboardView) : 'library';
}

interface NavItemProps {
  active: boolean;
  onClick: () => void;
  icon?: ReactNode;
  count?: number;
  children: ReactNode;
}

function NavItem({ active, onClick, icon, count, children }: NavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors',
        active ? 'bg-muted font-medium text-ink' : 'text-ink-2 hover:bg-subtle hover:text-ink',
      )}
    >
      {icon ?? <span className="w-3.5" />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined && count > 0 && <span className="text-[11px] text-ink-3 tabular-nums">{count}</span>}
    </button>
  );
}

export function Dashboard() {
  const store = useStore();
  const { service, library, trash, settings } = store;
  const toast = useToast();
  const { found, held } = useFound();
  const [view, setView] = useState<DashboardView>(viewFromHash);
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [captured, setCaptured] = useState<string | null>(null);
  // Opened at #/welcome right after install, or from Settings.
  const [welcome, setWelcome] = useState(() => window.location.hash.replace(/^#\/?/, '') === 'welcome');
  const [createRequest, setCreateRequest] = useState(0);

  useEffect(() => {
    const onHash = () => {
      setView(viewFromHash());
      if (window.location.hash.replace(/^#\/?/, '') === 'welcome') setWelcome(true);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Fallback review surface for right-click captures when the popup can't open.
  useEffect(() => {
    void takePendingCapture().then((pending) => pending && setCaptured(pending.text));
  }, []);

  function go(next: DashboardView, nextCategory: Category | 'all' = 'all') {
    window.location.hash = `/${next}`;
    setView(next);
    setCategory(nextCategory);
  }

  const counts = useMemo(() => {
    const byCategory = new Map<string, number>();
    for (const memory of library) byCategory.set(memory.category, (byCategory.get(memory.category) ?? 0) + 1);
    return byCategory;
  }, [library]);

  return (
    <div className="flex h-screen min-w-0 bg-canvas">
      <nav
        aria-label="Sections"
        className="scroll-thin flex w-56 shrink-0 flex-col overflow-y-auto border-r border-line bg-subtle/60 px-2.5 py-4 max-md:w-48"
      >
        <div className="mb-4 flex items-center gap-2 px-2">
          <Logo size={22} />
          <span className="text-sm font-semibold">OmniMemory</span>
        </div>

        <NavItem
          active={view === 'library' && category === 'all'}
          onClick={() => go('library')}
          icon={<LibraryIcon size={14} />}
          count={library.length}
        >
          All memories
        </NavItem>
        <div className="mt-0.5 space-y-0.5">
          {CATEGORIES.map((name) => (
            <NavItem
              key={name}
              active={view === 'library' && category === name}
              onClick={() => go('library', name)}
              count={counts.get(name)}
            >
              {name}
            </NavItem>
          ))}
        </div>

        <div className="my-3 border-t border-line" />
        <NavItem active={view === 'review'} onClick={() => go('review')} icon={<Inbox size={14} />} count={found.length}>
          Review
        </NavItem>
        <NavItem active={view === 'chatbots'} onClick={() => go('chatbots')} icon={<Bot size={14} />} count={held.length}>
          Chatbot memory
        </NavItem>
        <NavItem active={view === 'trash'} onClick={() => go('trash')} icon={<Trash2 size={14} />} count={trash.length}>
          Recently Deleted
        </NavItem>
        <NavItem active={view === 'settings'} onClick={() => go('settings')} icon={<SettingsIcon size={14} />}>
          Settings
        </NavItem>

        <div className="mt-auto rounded-lg border border-line bg-surface p-2.5">
          <label className="flex items-center gap-2 text-xs font-medium">
            <span className="flex-1">{settings.sharingPaused ? 'Sharing paused' : 'Sharing on'}</span>
            <Toggle
              label="Share memories with chatbots"
              checked={!settings.sharingPaused}
              onChange={(on) => void service.updateSettings({ sharingPaused: !on })}
            />
          </label>
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
            {settings.sharingPaused
              ? 'No chatbot can receive memories, and nothing is synced, until you turn this back on.'
              : 'Chatbots get the memories you insert, and synced memories are kept in their own memory.'}
          </p>
        </div>
      </nav>

      <main className="flex min-w-0 flex-1 flex-col">
        {view === 'library' && <Library store={store} category={category} createRequest={createRequest} />}
        {view === 'review' && <ReviewView store={store} />}
        {view === 'chatbots' && <ChatbotsView store={store} />}
        {view === 'trash' && <Trash store={store} />}
        {view === 'settings' && <SettingsView store={store} />}
      </main>

      <Welcome
        open={welcome}
        store={store}
        onClose={() => {
          setWelcome(false);
          if (window.location.hash.replace(/^#\/?/, '') === 'welcome') go('library');
        }}
        onAddMemory={() => {
          go('library');
          setCreateRequest((count) => count + 1);
        }}
      />

      <Dialog open={captured !== null} onClose={() => setCaptured(null)} title="Review before saving">
        {captured !== null && (
          <MemoryForm
            initial={{ content: captured }}
            defaultPermissions={settings.defaultPermissions}
            existing={library}
            submitLabel="Save memory"
            onSubmit={async (values) => {
              await service.create({ ...values, source: 'selection' });
              setCaptured(null);
              toast('Memory saved');
            }}
            onCancel={() => setCaptured(null)}
          />
        )}
      </Dialog>
    </div>
  );
}
