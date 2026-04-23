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
import logoUrl from '../assets/logo.png';

interface NavItem {
  id: RouteId;
  label: string;
  icon: IconName;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: '仪表盘', icon: 'dashboard' },
  { id: 'files',     label: '文件',   icon: 'files' },
  { id: 'terminal',  label: '终端',   icon: 'terminal' },
  { id: 'services',  label: '服务',   icon: 'services' },
  { id: 'processes', label: '进程',   icon: 'processes' },
  { id: 'firewall',  label: '防火墙', icon: 'firewall' },
  { id: 'docker',    label: 'Docker', icon: 'docker' },
  { id: 'cron',      label: '任务',   icon: 'cron' },
  { id: 'settings',  label: '设置',   icon: 'settings' },
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
        <img className="ns-topbar__brand-mark" src={logoUrl} alt="Next Panel" />
        <span>Next Panel</span>
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
        <button className="ns-iconbtn" onClick={onRefresh} title="刷新当前视图" aria-label="刷新">
          <Icon name="refresh" size={16} />
        </button>
      )}
      <button
        className="ns-iconbtn"
        onClick={onToggleAI}
        data-active={aiDrawerOpen}
        title="AI 助手"
        aria-label="AI 助手"
      >
        <Icon name="sparkle" size={18} />
      </button>
    </header>
  );
}
