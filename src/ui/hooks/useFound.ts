import { useCallback, useEffect, useState } from 'react';
import type { FoundItem } from '../../core/discover';
import type { HeldChange } from '../../core/sync';
import type { SiteId } from '../../core/types';
import { onChange } from '../../shared/change-bus';
import { getSyncService } from '../../shared/platform';

export type HeldItem = HeldChange & { site: SiteId };

/**
 * Live lists of what's waiting on the user: things found on the chatbots
 * (Review page) and sync changes that need an OK (Chatbot memory page).
 */
export function useFound(): { found: FoundItem[]; held: HeldItem[]; loading: boolean } {
  const [found, setFound] = useState<FoundItem[]>([]);
  const [held, setHeld] = useState<HeldItem[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const sync = getSyncService();
    const [nextFound, nextHeld] = await Promise.all([sync.allFound(), sync.allHeld()]);
    setFound(nextFound);
    setHeld(nextHeld);
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
    return onChange(() => void load());
  }, [load]);
  return { found, held, loading };
}
