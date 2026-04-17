// Fetch a SystemInfo snapshot for the Dashboard.
//
// We deliberately reuse the same SystemInfoTool that the AI agent uses — the
// whole v2 design principle is that what the UI shows and what the AI sees are
// the exact same signals, parsed by the exact same code. No drift, no "why did
// the panel say 62% but the AI claimed 84%".

import { useCallback, useEffect, useState } from 'react';
import { SystemInfoTool } from '../../agent/tools/SystemInfo';
import type { SystemSnapshot } from '../../agent/tools/SystemInfo';
import type { ExecutionTarget } from '../../agent/types';

export interface SystemSnapshotState {
  snapshot: SystemSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useSystemSnapshot(connectionId: number | null, refreshTick = 0): SystemSnapshotState {
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localTick, setLocalTick] = useState(0);

  const refresh = useCallback(() => setLocalTick((n) => n + 1), []);

  useEffect(() => {
    if (connectionId == null) {
      setSnapshot(null);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const target: ExecutionTarget = { kind: 'remote', connectionId };

    setLoading(true);
    setError(null);
    SystemInfoTool.execute({}, { target, signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.isError) {
          setError(result.content);
          setSnapshot(null);
        } else {
          setSnapshot((result.data as SystemSnapshot) ?? null);
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [connectionId, refreshTick, localTick]);

  return { snapshot, loading, error, refresh };
}
