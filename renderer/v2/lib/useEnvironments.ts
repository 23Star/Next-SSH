// Load the saved SSH environments from the main-process store.
//
// This is a lightweight "fetch once, refresh on demand" hook — nothing fancy.
// v2 doesn't need reactive store coordination yet; pages that mutate the list
// call `refresh()` afterward.

import { useCallback, useEffect, useState } from 'react';
import { getApi, type Environment } from './electron';

export interface EnvironmentsState {
  hosts: Environment[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useEnvironments(): EnvironmentsState {
  const [hosts, setHosts] = useState<Environment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const api = getApi();
      const list = await api.environment.list();
      setHosts(list);
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
