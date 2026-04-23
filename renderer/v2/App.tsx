// Root component for the v2 shell.
//
// Owns the three pieces of global shell state — route, active host
// connection, and AI drawer — and wires them into Topbar / page content /
// AIDrawer. Module nav used to live in a left rail; in Phase 4 it was
// promoted into the top bar as pill tabs (1Panel-style), so the shell is
// now a single row + main + optional right drawer.
//
// Dashboard and the AI drawer both consume a live SystemInfo snapshot via
// useSystemSnapshot. Hoisting the hook here means the panel and the assistant
// share one fetch — no duplicate SSH round-trips.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Topbar } from './shell/Topbar';
import { AIDrawer } from './shell/AIDrawer';
import { useEnvironments } from './lib/useEnvironments';
import { useConnection } from './lib/useConnection';
import { useSystemSnapshot } from './lib/useSystemSnapshot';
import { usePreload, getPreloadState } from './lib/usePreload';
import { Dashboard } from './pages/Dashboard';
import { Files } from './pages/Files';
import { Terminal } from './pages/Terminal';
import { Services } from './pages/Services';
import { Processes } from './pages/Processes';
import { Firewall } from './pages/Firewall';
import { Docker } from './pages/Docker';
import { Cron } from './pages/Cron';
import { Settings } from './pages/Settings';
import { ConnectPage } from './pages/ConnectPage';
import type { ExecutionTarget } from '../agent/types';
import type { Environment } from './lib/electron';

export type RouteId =
  | 'dashboard'
  | 'files'
  | 'terminal'
  | 'services'
  | 'processes'
  | 'firewall'
  | 'docker'
  | 'cron'
  | 'settings';

function hostLabelFor(env: Environment | null | undefined): string | null {
  if (!env) return null;
  return env.name?.trim() || `${env.username}@${env.host}`;
}

export function App(): React.ReactElement {
  const [route, setRoute] = useState<RouteId>('dashboard');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const { hosts, refresh: refreshHosts } = useEnvironments();
  const connection = useConnection();

  // Dashboard and the AI drawer both want the SystemInfo snapshot; fetching
  // here and threading it down keeps the request to one per refresh.
  const snapshotState = useSystemSnapshot(connection.connectionId, refreshTick);

  // Preload page data on connect and cache it for instant tab switching.
  usePreload(connection.connectionId, connection.status);

  // Track preload progress for the loading indicator
  const [preloadProgress, setPreloadProgress] = useState({ loading: false, progress: 0, total: 5, step: '' });
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (connection.status !== 'connected') {
      setPreloadProgress({ loading: false, progress: 0, total: 5, step: '' });
      return;
    }
    progressTimerRef.current = setInterval(() => {
      const s = getPreloadState();
      setPreloadProgress({ loading: s.loading, progress: s.progress, total: s.totalSteps, step: s.currentStep });
      if (!s.loading && progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
    }, 400);
    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, [connection.status]);

  const target: ExecutionTarget | null = useMemo(() => {
    if (connection.connectionId == null) return null;
    return { kind: 'remote', connectionId: connection.connectionId };
  }, [connection.connectionId]);

  const activeHost = hosts.find((h) => h.id === connection.hostId) ?? null;
  const hostLabel = hostLabelFor(activeHost);

  const handleSelectHost = (id: number | null): void => {
    void connection.select(id);
  };

  const handleRefresh = (): void => {
    void refreshHosts();
    setRefreshTick((n) => n + 1);
  };

  const handleOpenSettings = (): void => {
    setRoute('settings');
  };

  // Settings is always accessible; everything else requires a connection.
  const isConnected = connection.status === 'connected';
  const showConnectPage = !isConnected && route !== 'settings';

  return (
    <div className="ns-shell">
      <Topbar
        hosts={hosts}
        activeHostId={connection.hostId}
        connStatus={connection.status}
        aiDrawerOpen={drawerOpen}
        route={route}
        onNavigate={setRoute}
        onSelectHost={handleSelectHost}
        onOpenSettings={handleOpenSettings}
        onToggleAI={() => setDrawerOpen((v) => !v)}
        onRefresh={handleRefresh}
      />
      <main className="ns-main">
        {preloadProgress.loading && (
          <div className="ns-preload-bar">
            <div
              className="ns-preload-bar__fill"
              style={{ width: `${(preloadProgress.progress / preloadProgress.total) * 100}%` }}
            />
            <span className="ns-preload-bar__text">
              正在预加载数据… {preloadProgress.step} ({preloadProgress.progress}/{preloadProgress.total})
            </span>
          </div>
        )}
        {showConnectPage ? (
          <ConnectPage
            hosts={hosts}
            connStatus={connection.status}
            connError={connection.error}
            onSelectHost={handleSelectHost}
          />
        ) : (
          <RouteContent
            route={route}
            connectionId={connection.connectionId}
            connStatus={connection.status}
            connError={connection.error}
            snapshot={snapshotState.snapshot}
            snapshotLoading={snapshotState.loading}
            snapshotError={snapshotState.error}
            refreshTick={refreshTick}
          />
        )}
      </main>
      <AIDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        target={target}
        hostLabel={hostLabel}
        snapshot={snapshotState.snapshot}
      />
    </div>
  );
}

interface RouteContentProps {
  route: RouteId;
  connectionId: number | null;
  connStatus: string;
  connError: string | null;
  snapshot: ReturnType<typeof useSystemSnapshot>['snapshot'];
  snapshotLoading: boolean;
  snapshotError: string | null;
  refreshTick: number;
}

function RouteContent({
  route,
  connectionId,
  connStatus,
  connError,
  snapshot,
  snapshotLoading,
  snapshotError,
  refreshTick,
}: RouteContentProps): React.ReactElement {
  switch (route) {
    case 'dashboard':
      return (
        <Dashboard
          connectionId={connectionId}
          connStatus={connStatus}
          connError={connError}
          snapshot={snapshot}
          loading={snapshotLoading}
          snapshotError={snapshotError}
        />
      );
    case 'files':
      return <Files connectionId={connectionId} connStatus={connStatus} refreshTick={refreshTick} />;
    case 'terminal':
      return <Terminal connectionId={connectionId} connStatus={connStatus} refreshTick={refreshTick} />;
    case 'services':
      return <Services connectionId={connectionId} connStatus={connStatus} refreshTick={refreshTick} />;
    case 'processes':
      return <Processes connectionId={connectionId} connStatus={connStatus} refreshTick={refreshTick} />;
    case 'firewall':
      return <Firewall connectionId={connectionId} connStatus={connStatus} refreshTick={refreshTick} />;
    case 'docker':
      return <Docker connectionId={connectionId} connStatus={connStatus} refreshTick={refreshTick} />;
    case 'cron':
      return <Cron connectionId={connectionId} connStatus={connStatus} refreshTick={refreshTick} />;
    case 'settings':
      return <Settings />;
  }
}
