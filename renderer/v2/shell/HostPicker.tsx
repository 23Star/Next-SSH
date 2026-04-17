// Topbar host picker. Shows the active SSH target + connection status, opens
// a dropdown with the saved environments. Connection management itself stays
// minimal in Phase 2a — we only display state; actually connecting and
// reconnecting lives in the ssh handlers as before.

import React from 'react';
import { Icon } from '../components/Icon';
import type { Environment } from '../lib/electron';

export type ConnStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface HostPickerProps {
  hosts: Environment[];
  activeId: number | null;
  status: ConnStatus;
  onSelect: (id: number | null) => void;
}

function labelFor(env: Environment): string {
  const name = env.name?.trim();
  if (name) return name;
  return `${env.username}@${env.host}`;
}

export function HostPicker({ hosts, activeId, status, onSelect }: HostPickerProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const active = hosts.find((h) => h.id === activeId) ?? null;

  // Close on outside click.
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="ns-hostpicker"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="ns-hostpicker__dot" data-status={status} />
        <span className="ns-hostpicker__label">{active ? labelFor(active) : 'No host selected'}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            minWidth: 260,
            background: 'var(--surface)',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--shadow-pop)',
            padding: '6px',
            zIndex: 20,
          }}
        >
          {hosts.length === 0 && (
            <div style={{ padding: '14px 12px', color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
              No saved hosts. Add one in Settings.
            </div>
          )}
          {hosts.map((h) => (
            <button
              key={h.id}
              role="option"
              aria-selected={h.id === activeId}
              className="ns-nav-item"
              data-active={h.id === activeId}
              onClick={() => {
                onSelect(h.id);
                setOpen(false);
              }}
              style={{ width: '100%', height: 34 }}
            >
              <span className="ns-hostpicker__dot" data-status={h.id === activeId ? status : 'disconnected'} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{labelFor(h)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
