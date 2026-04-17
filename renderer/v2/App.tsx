// Root component for the v2 shell.
//
// Owns the three pieces of global shell state — the currently selected route,
// the active host connection, and whether the AI drawer is open — and wires
// them into Sidebar / Topbar / page content / AIDrawer. Everything else flows
// down as props so individual pages stay independent and easy to unit-test.

import React, { useState } from 'react';
import { Sidebar } from './shell/Sidebar';
import { Topbar } from './shell/Topbar';
import { AIDrawer } from './shell/AIDrawer';
import { useEnvironments } from './lib/useEnvironments';
import { useConnection } from './lib/useConnection';
import { Dashboard } from './pages/Dashboard';
import { ComingSoon } from './pages/ComingSoon';

export type RouteId =
  | 'dashboard'
  | 'files'
  | 'terminal'
  | 'services'
  | 'processes'
  | 'firewall'
  | 'cron'
  | 'settings';

export function App(): React.ReactElement {
  const [route, setRoute] = useState<RouteId>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Refresh tick lets the topbar refresh button re-trigger the active page's
  // data hook without the page having to expose its own imperative API.
  const [refreshTick, setRefreshTick] = useState(0);

  const { hosts, refresh: refreshHosts } = useEnvironments();
  const connection = useConnection();

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
          refreshTick={refreshTick}
        />
      </main>
      <AIDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}

interface RouteContentProps {
  route: RouteId;
  connectionId: number | null;
  connStatus: string;
  connError: string | null;
  refreshTick: number;
}

function RouteContent({ route, connectionId, connStatus, connError, refreshTick }: RouteContentProps): React.ReactElement {
  switch (route) {
    case 'dashboard':
      return (
        <Dashboard
          connectionId={connectionId}
          connStatus={connStatus}
          connError={connError}
          refreshTick={refreshTick}
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
