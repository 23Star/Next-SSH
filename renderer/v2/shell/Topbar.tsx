import React from 'react';
import { HostPicker, type ConnStatus } from './HostPicker';
import { Icon } from '../components/Icon';
import type { Environment } from '../lib/electron';

export interface TopbarProps {
  hosts: Environment[];
  activeHostId: number | null;
  connStatus: ConnStatus;
  aiDrawerOpen: boolean;
  onSelectHost: (id: number | null) => void;
  onToggleAI: () => void;
  onRefresh?: () => void;
}

export function Topbar({
  hosts,
  activeHostId,
  connStatus,
  aiDrawerOpen,
  onSelectHost,
  onToggleAI,
  onRefresh,
}: TopbarProps): React.ReactElement {
  return (
    <header className="ns-topbar">
      <HostPicker
        hosts={hosts}
        activeId={activeHostId}
        status={connStatus}
        onSelect={onSelectHost}
      />
      <div className="ns-topbar__spacer" />
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
