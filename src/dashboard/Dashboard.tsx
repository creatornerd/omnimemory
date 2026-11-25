import { useEffect, useState, type ReactNode } from 'react';
import { Bot, House, Inbox, Info, Library as LibraryIcon, Settings as SettingsIcon, Sparkles, Trash2 } from 'lucide-react';
import type { Category } from '../core';
import { DASHBOARD_VIEWS, type DashboardView } from '../shared/messages';
import { takePendingCapture } from '../shared/platform';
import { MemoryForm } from '../ui/components/MemoryForm';
import { Dialog } from '../ui/components/Dialog';
import { Logo, Toggle } from '../ui/components/primitives';
import { ThemeToggle } from '../ui/components/ThemeToggle';
import { useToast } from '../ui/components/Toast';
import { cx } from '../ui/format';
import { useStore } from '../ui/hooks/useStore';
import { useFound } from '../ui/hooks/useFound';
import { AboutView } from './AboutView';
import { AssistantView } from './AssistantView';
import { HomeView } from './HomeView';
import { ChatbotsView } from './ChatbotsView';
import { ReviewView } from './ReviewView';
import { Library } from './Library';
import { SettingsView } from './SettingsView';
import { Trash } from './Trash';
import { Welcome } from './Welcome';
import { repeatCheck } from '../ui/hooks/repeat-check';
import { Help } from './help';

function viewFromHash(): DashboardView {
  const view = window.location.hash.replace(/^#\/?/, '');
  return (DASHBOARD_VIEWS as readonly string[]).includes(view) ? (view as DashboardView) : 'home';
}

interface NavItemProps {
  active: boolean;
  onClick: () => void;
  icon?: ReactNode;
  count?: number;
  /** An amber dot: something here is waiting on you. */
  dot?: boolean;
  small?: boolean;
  children: ReactNode;
}

function NavItem({ active, onClick, icon, count, dot, small, children }: NavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors',
        small ? 'h-8 text-[13px]' : 'h-[34px] text-[13.5px]',
        active ? 'bg-muted font-semibold text-ink' : 'text-ink-2 hover:bg-muted/60 hover:text-ink',
      )}
    >
      {icon ?? <span className="w-4" />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {dot && <span className="size-[7px] rounded-full bg-warn" aria-label="Needs your OK" />}
      {count !== undefined && count > 0 && <span className="text-xs font-medium text-ink-3 tabular-nums">{count}</span>}
    </button>
  );
}

export function Dashboard() {
  const store = useStore();
  const { service, library, trash, settings } = store;
  const toast = useToast();
  const { found, held } = useFound();
  const [view, setView] = useState<DashboardView>(viewFromHash);
  const [captured, setCaptured] = useState<string | null>(null);
  // Opened at #/welcome right after install, or from Settings.
  const [welcome, setWelcome] = useState(() => window.location.hash.replace(/^#\/?/, '') === 'welcome');
  const [createRequest, setCreateRequest] = useState(0);
  const [searchRequest, setSearchRequest] = useState<{ query: string; category?: Category; n: number } | undefined>();

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

  function go(next: DashboardView) {
    window.location.hash = `/${next}`;
    setView(next);
  }

  return (
    <div className="flex h-screen min-w-0 bg-canvas">
      <nav
        aria-label="Sections"
        className="scroll-thin flex w-[232px] shrink-0 flex-col overflow-y-auto border-r border-line bg-subtle px-3 py-4 max-md:w-52"
      >
        <div className="flex items-center gap-2.5 px-2 pt-1 pb-5">
          <Logo size={24} />
          <span className="text-[15px] font-semibold tracking-[-0.02em]">OmniMemory</span>
        </div>

        <div className="space-y-0.5">
          <NavItem active={view === 'home'} onClick={() => go('home')} icon={<House size={16} />}>
            Home
          </NavItem>
          <NavItem active={view === 'library'} onClick={() => go('library')} icon={<LibraryIcon size={16} />} count={library.length}>
            Memories
          </NavItem>
          <NavItem active={view === 'review'} onClick={() => go('review')} icon={<Inbox size={16} />} count={found.length}>
            Review
          </NavItem>
          <NavItem active={view === 'chatbots'} onClick={() => go('chatbots')} icon={<Bot size={16} />} dot={held.length > 0}>
            Chatbots
          </NavItem>
          <NavItem active={view === 'assistant'} onClick={() => go('assistant')} icon={<Sparkles size={16} />}>
            Assistant
          </NavItem>
        </div>

        <div className="min-h-6 flex-1" />

        <div className="mb-3 space-y-0.5">
          <NavItem small active={view === 'trash'} onClick={() => go('trash')} icon={<Trash2 size={15} />} count={trash.length}>
            Recently deleted
          </NavItem>
          <NavItem small active={view === 'settings'} onClick={() => go('settings')} icon={<SettingsIcon size={15} />}>
            Settings
          </NavItem>
          <NavItem small active={view === 'about'} onClick={() => go('about')} icon={<Info size={15} />}>
            About
          </NavItem>
          <ThemeToggle variant="row" theme={settings.theme} onChange={(theme) => void service.updateSettings({ theme })} />
        </div>

        <div className="rounded-xl border border-line bg-surface p-3">
          <label className="flex items-center gap-2">
            <span className="flex flex-1 items-center gap-1 text-[13px] font-semibold">
              {settings.sharingPaused ? 'Sharing paused' : 'Sharing with chatbots'}
              <Help id="sidebar.sharing" />
            </span>
            <Toggle
              label="Share memories with chatbots"
              checked={!settings.sharingPaused}
              onChange={(on) => void service.updateSettings({ sharingPaused: !on })}
            />
          </label>
          <p className="mt-1.5 text-[11.5px] leading-normal text-ink-3">
            {settings.sharingPaused
              ? 'No chatbot can receive memories, and nothing is synced, until you turn this back on.'
              : 'Chatbots get the memories you add to a chat, and synced ones stay in their own memory.'}
          </p>
        </div>
      </nav>

      <main className="flex min-w-0 flex-1 flex-col">
        {view === 'home' && (
          <HomeView
            store={store}
            found={found}
            held={held}
            onNavigate={go}
            onSearch={(query) => {
              setSearchRequest((current) => ({ query, n: (current?.n ?? 0) + 1 }));
              go('library');
            }}
            onCategory={(category) => {
              setSearchRequest((current) => ({ query: '', category, n: (current?.n ?? 0) + 1 }));
              go('library');
            }}
            onCreate={() => {
              go('library');
              setCreateRequest((count) => count + 1);
            }}
          />
        )}
        {view === 'library' && <Library store={store} createRequest={createRequest} searchRequest={searchRequest} />}
        {view === 'assistant' && <AssistantView store={store} />}
        {view === 'review' && <ReviewView store={store} />}
        {view === 'chatbots' && <ChatbotsView store={store} />}
        {view === 'trash' && <Trash store={store} />}
        {view === 'settings' && <SettingsView store={store} />}
        {view === 'about' && <AboutView />}
      </main>

      <Welcome
        open={welcome}
        store={store}
        onClose={() => {
          setWelcome(false);
          if (window.location.hash.replace(/^#\/?/, '') === 'welcome') go('home');
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
            checkRepeats={repeatCheck(settings, library)}
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
