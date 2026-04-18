// Root component for the v2 shell.
//
// Owns the four pieces of global shell state — route, active host connection,
// sidebar collapse, and AI drawer — and wires them into Sidebar / Topbar /
// page content / AIDrawer. Everything else flows down as props so individual
// pages stay independent and easy to unit-test.
//
// Dashboard and the AI drawer both consume a live SystemInfo snapshot via
// useSystemSnapshot. Hoisting the hook here means the panel and the assistant
// share one fetch — no duplicate SSH round-trips.

import React, { useMemo, useState } from 'react';
import { Sidebar } from './shell/Sidebar';
import { Topbar } from './shell/Topbar';
import { AIDrawer } from './shell/AIDrawer';
import { useEnvironments } from './lib/useEnvironments';
import { useConnection } from './lib/useConnection';
import { useSystemSnapshot } from './lib/useSystemSnapshot';
import { Dashboard } from './pages/Dashboard';
import { ComingSoon } from './pages/ComingSoon';
import type { ExecutionTarget } from '../agent/types';
import type { Environment } from './lib/electron';

export type RouteId =
  | 'dashboard'
  | 'files'
  | 'terminal'
  | 'services'
  | 'processes'
  | 'firewall'
  | 'cron'
  | 'settings';

function hostLabelFor(env: Environment | null | undefined): string | null {
  if (!env) return null;
  return env.name?.trim() || `${env.username}@${env.host}`;
}

export function App(): React.ReactElement {
  const [route, setRoute] = useState<RouteId>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const { hosts, refresh: refreshHosts } = useEnvironments();
  const connection = useConnection();

  // Dashboard and the AI drawer both want the SystemInfo snapshot; fetching
  // here and threading it down keeps the request to one per refresh.
  const snapshotState = useSystemSnapshot(connection.connectionId, refreshTick);

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

  return (
    <div className="ns-shell">
      <Sidebar
        active={route}
        onNavigate={setRoute}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
      />
      <Topbar
        hosts={hosts}
        activeHostId={connection.hostId}
        connStatus={connection.status}
        aiDrawerOpen={drawerOpen}
        onSelectHost={handleSelectHost}
        onToggleAI={() => setDrawerOpen((v) => !v)}
        onRefresh={handleRefresh}
      />
      <main className="ns-main">
        <RouteContent
          route={route}
          connectionId={connection.connectionId}
          connStatus={connection.status}
          connError={connection.error}
          snapshot={snapshotState.snapshot}
          snapshotLoading={snapshotState.loading}
          snapshotError={snapshotState.error}
        />
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
}

function RouteContent({
  route,
  connectionId,
  connStatus,
  connError,
  snapshot,
  snapshotLoading,
  snapshotError,
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
      return <ComingSoon title="Files" hint="SFTP browser, multi-tab transfers, preview, and permission tools." />;
    case 'terminal':
      return <ComingSoon title="Terminal" hint="xterm.js with tabs, split panes, and reconnect — wiring to the existing shell handlers." />;
    case 'services':
      return <ComingSoon title="Services" hint="systemd unit list — status, start/stop/restart, live journal tail." />;
    case 'processes':
      return <ComingSoon title="Processes" hint="Live ps + top-style sortable table, per-process cgroup & limits." />;
    case 'firewall':
      return <ComingSoon title="Firewall" hint="UFW / firewalld / nftables rules, port quick-open, diff before apply." />;
    case 'cron':
      return <ComingSoon title="Scheduled tasks" hint="Crontab editor with schedule preview and run history." />;
    case 'settings':
      return <ComingSoon title="Settings" hint="Saved hosts, keys, AI provider + model, appearance, permission rules." />;
  }
}
