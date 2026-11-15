import { useCallback, useEffect, useState } from 'react';
import type { FoundItem } from '../../core/discover';
import { onChange } from '../../shared/change-bus';
import { getSyncService } from '../../shared/platform';

/** Live list of things found on the chatbots and waiting for review. */
export function useFound(): { found: FoundItem[]; loading: boolean } {
  const [found, setFound] = useState<FoundItem[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setFound(await getSyncService().allFound());
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
    return onChange(() => void load());
  }, [load]);
  return { found, loading };
}
