import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_SETTINGS, type Memory, type Settings } from '../../core/types';
import type { MemoryService } from '../../core/service';
import { onChange } from '../../shared/change-bus';
import { getService } from '../../shared/platform';
import { applyTheme } from '../theme';

export interface Store {
  service: MemoryService;
  loading: boolean;
  /** Active + outdated memories. */
  library: Memory[];
  trash: Memory[];
  settings: Settings;
  refresh: () => Promise<void>;
}

/**
 * Live view of the database for extension pages. Re-reads whenever any
 * context (popup, dashboard, a chatbot tab) changes something.
 */
export function useStore(): Store {
  const service = useMemo(() => getService(), []);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [all, nextSettings] = await Promise.all([service.all(), service.getSettings()]);
    setMemories(all);
    setSettings(nextSettings);
    setLoading(false);
  }, [service]);

  useEffect(() => {
    void service.purgeExpired().finally(refresh);
    return onChange(() => void refresh());
  }, [service, refresh]);

  useEffect(() => {
    if (!loading) applyTheme(settings.theme);
  }, [loading, settings.theme]);

  const library = useMemo(() => memories.filter((m) => m.status !== 'deleted'), [memories]);
  const trash = useMemo(
    () =>
      memories
        .filter((m) => m.status === 'deleted')
        .sort((a, b) => (b.deleted_at ?? '').localeCompare(a.deleted_at ?? '')),
    [memories],
  );

  return { service, loading, library, trash, settings, refresh };
}
