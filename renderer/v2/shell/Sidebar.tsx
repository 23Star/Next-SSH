// Left sidebar with the module list.
//
// Each nav item is a real panel page (Dashboard, Files, ...) — NOT a
// quick-prompt that talks to the AI. That's the entire point of the v2
// refactor: the panel is the UI, the AI is an optional right-side drawer.

import React from 'react';
import { Icon, type IconName } from '../components/Icon';
import type { RouteId } from '../App';

interface NavItem {
  id: RouteId;
  label: string;
  icon: IconName;
  group: 'main' | 'system';
}

const ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', group: 'main' },
  { id: 'files',     label: 'Files',     icon: 'files',     group: 'main' },
  { id: 'terminal',  label: 'Terminal',  icon: 'terminal',  group: 'main' },
  { id: 'services',  label: 'Services',  icon: 'services',  group: 'system' },
  { id: 'processes', label: 'Processes', icon: 'processes', group: 'system' },
  { id: 'firewall',  label: 'Firewall',  icon: 'firewall',  group: 'system' },
  { id: 'cron',      label: 'Scheduled', icon: 'cron',      group: 'system' },
  { id: 'settings',  label: 'Settings',  icon: 'settings',  group: 'system' },
];

export interface SidebarProps {
  active: RouteId;
  onNavigate: (id: RouteId) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function Sidebar({ active, onNavigate, collapsed, onToggleCollapsed }: SidebarProps): React.ReactElement {
  const mainItems = ITEMS.filter((i) => i.group === 'main');
  const systemItems = ITEMS.filter((i) => i.group === 'system');

  return (
    <aside className="ns-sidebar" data-collapsed={collapsed}>
      <div className="ns-sidebar__brand">
        <span className="ns-sidebar__brand-mark" aria-hidden="true" />
        {!collapsed && <span>Next-SSH</span>}
      </div>
      <nav className="ns-sidebar__nav" aria-label="Modules">
        {!collapsed && <div className="ns-sidebar__section">Workspace</div>}
        {mainItems.map((item) => (
          <NavItemView key={item.id} item={item} active={active === item.id} onNavigate={onNavigate} />
        ))}
        {!collapsed && <div className="ns-sidebar__section">System</div>}
        {systemItems.map((item) => (
          <NavItemView key={item.id} item={item} active={active === item.id} onNavigate={onNavigate} />
        ))}
      </nav>
      <div className="ns-sidebar__footer">
        <button
          className="ns-iconbtn"
          onClick={onToggleCollapsed}
          title={collapsed ? 'Expand' : 'Collapse'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={16} />
        </button>
      </div>
    </aside>
  );
}

function NavItemView({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate: (id: RouteId) => void;
}): React.ReactElement {
  return (
    <button
      className="ns-nav-item"
      data-active={active}
      onClick={() => onNavigate(item.id)}
      title={item.label}
    >
      <span className="ns-nav-item__icon">
        <Icon name={item.icon} size={18} />
      </span>
      <span className="ns-nav-item__label">{item.label}</span>
    </button>
  );
}
