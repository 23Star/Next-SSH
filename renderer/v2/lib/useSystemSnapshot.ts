// Fetch a SystemInfo snapshot for the Dashboard.
//
// We deliberately reuse the same SystemInfoTool that the AI agent uses — the
// whole v2 design principle is that what the UI shows and what the AI sees are
// the exact same signals, parsed by the exact same code. No drift, no "why did
// the panel say 62% but the AI claimed 84%".
//
// SWR pattern: seeds from the session cache so host switches don't flash an
// empty dashboard, then revalidates in the background. Also polls while
// mounted so long-running dashboards stay live without the user hitting
// refresh.

import { useCallback, useEffect, useRef, useState } from 'react';
import { SystemInfoTool } from '../../agent/tools/SystemInfo';
import type { SystemSnapshot } from '../../agent/tools/SystemInfo';
import type { ExecutionTarget } from '../../agent/types';
import { readCache, writeCache } from './cache';

export interface SystemSnapshotState {
  snapshot: SystemSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const POLL_INTERVAL_MS = 15_000;

function cacheKey(connectionId: number): string {
  return `sys:${connectionId}`;
}

export function useSystemSnapshot(connectionId: number | null, refreshTick = 0): SystemSnapshotState {
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(() =>
    connectionId != null ? readCache<SystemSnapshot>(cacheKey(connectionId)) ?? null : null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localTick, setLocalTick] = useState(0);
  const activeRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => setLocalTick((n) => n + 1), []);

  useEffect(() => {
    if (connectionId == null) {
      setSnapshot(null);
      setError(null);
      setLoading(false);
      return;
    }

    // Seed from cache immediately so host switches don't blank the dashboard.
    const cached = readCache<SystemSnapshot>(cacheKey(connectionId));
    if (cached) {
      setSnapshot(cached);
      setError(null);
    }

    const run = async (): Promise<void> => {
      activeRef.current?.abort();
      const controller = new AbortController();
      activeRef.current = controller;

      // Only show the spinner when we have nothing to show yet — otherwise the
      // user keeps the old numbers while the new fetch lands.
      if (!cached) setLoading(true);
      setError(null);

      const target: ExecutionTarget = { kind: 'remote', connectionId };
      try {
        const result = await SystemInfoTool.execute({}, { target, signal: controller.signal });
        if (controller.signal.aborted) return;
        if (result.isError) {
          setError(result.content);
          // Keep the stale snapshot on error so the user still sees something.
        } else {
          const snap = (result.data as SystemSnapshot) ?? null;
          setSnapshot(snap);
          if (snap) writeCache(cacheKey(connectionId), snap);
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void run();
    const timer = window.setInterval(() => void run(), POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
      activeRef.current?.abort();
    };
  }, [connectionId, refreshTick, localTick]);

  return { snapshot, loading, error, refresh };
}
