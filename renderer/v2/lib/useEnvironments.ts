// Load the saved SSH environments from the main-process store.
//
// SWR: seeds from session cache so the topbar host picker stays populated
// across shell re-mounts, then revalidates. `refresh()` forces a round trip —
// the Topbar refresh button and any mutation flow calls it after saving.

import { useCallback, useEffect, useState } from 'react';
import { getApi, type Environment } from './electron';
import { readCache, writeCache } from './cache';

const CACHE_KEY = 'env:hosts';

export interface EnvironmentsState {
  hosts: Environment[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useEnvironments(): EnvironmentsState {
  const [hosts, setHosts] = useState<Environment[]>(() => readCache<Environment[]>(CACHE_KEY) ?? []);
  const [loading, setLoading] = useState(() => readCache<Environment[]>(CACHE_KEY) === undefined);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    // Only flip the spinner when we have nothing cached — the SWR ideal is
    // "always show the last good data while we revalidate."
    if (readCache<Environment[]>(CACHE_KEY) === undefined) setLoading(true);
    try {
      const api = getApi();
      const list = await api.environment.list();
      setHosts(list);
      writeCache(CACHE_KEY, list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { hosts, loading, error, refresh };
}
