// Top bar — 1Panel-style: brand, module tabs, host picker, AI toggle.
//
// v2 originally had a left rail, but the rail was dead weight: the module
// count is small, the labels are short, and a horizontal top row reads more
// naturally for a control panel. The rail has been promoted here as pill
// tabs; pages don't know or care where the nav lives.

import React from 'react';
import { HostPicker, type ConnStatus } from './HostPicker';
import { Icon, type IconName } from '../components/Icon';
import type { Environment } from '../lib/electron';
import type { RouteId } from '../App';

interface NavItem {
  id: RouteId;
  label: string;
  icon: IconName;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'files',     label: 'Files',     icon: 'files' },
  { id: 'terminal',  label: 'Terminal',  icon: 'terminal' },
  { id: 'services',  label: 'Services',  icon: 'services' },
  { id: 'processes', label: 'Processes', icon: 'processes' },
  { id: 'firewall',  label: 'Firewall',  icon: 'firewall' },
  { id: 'cron',      label: 'Scheduled', icon: 'cron' },
  { id: 'settings',  label: 'Settings',  icon: 'settings' },
];

export interface TopbarProps {
  hosts: Environment[];
  activeHostId: number | null;
  connStatus: ConnStatus;
  aiDrawerOpen: boolean;
  route: RouteId;
  onNavigate: (id: RouteId) => void;
  onSelectHost: (id: number | null) => void;
  onToggleAI: () => void;
  onRefresh?: () => void;
}

export function Topbar({
  hosts,
  activeHostId,
  connStatus,
  aiDrawerOpen,
  route,
  onNavigate,
  onSelectHost,
  onToggleAI,
  onRefresh,
}: TopbarProps): React.ReactElement {
  return (
    <header className="ns-topbar">
      <div className="ns-topbar__brand">
        <span className="ns-topbar__brand-mark" aria-hidden="true" />
        <span>Next-SSH</span>
      </div>
      <nav className="ns-topbar__nav" aria-label="Modules">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className="ns-tab"
            data-active={route === item.id}
            onClick={() => onNavigate(item.id)}
            title={item.label}
          >
            <span className="ns-tab__icon"><Icon name={item.icon} size={16} /></span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="ns-topbar__spacer" />
      <HostPicker
        hosts={hosts}
        activeId={activeHostId}
        status={connStatus}
        onSelect={onSelectHost}
      />
      {onRefresh && (
        <button className="ns-iconbtn" onClick={onRefresh} title="Refresh current view" aria-label="Refresh">
          <Icon name="refresh" size={16} />
        </button>
      )}
      <button
        className="ns-iconbtn"
        onClick={onToggleAI}
        data-active={aiDrawerOpen}
        title="Toggle AI assistant"
        aria-label="Toggle AI assistant"
      >
        <Icon name="sparkle" size={18} />
      </button>
    </header>
  );
}
