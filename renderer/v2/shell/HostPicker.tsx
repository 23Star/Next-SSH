import React from 'react';
import { Icon } from '../components/Icon';
import type { Environment } from '../lib/electron';

export type ConnStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface HostPickerProps {
  hosts: Environment[];
  activeId: number | null;
  status: ConnStatus;
  onSelect: (id: number | null) => void;
  onOpenSettings?: () => void;
}

function labelFor(env: Environment): string {
  const name = env.name?.trim();
  if (name) return name;
  return `${env.username}@${env.host}`;
}

export function HostPicker({ hosts, activeId, status, onSelect, onOpenSettings }: HostPickerProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const active = hosts.find((h) => h.id === activeId) ?? null;

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
            minWidth: 280,
            background: 'var(--surface)',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--shadow-pop)',
            padding: 6,
            zIndex: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {hosts.length === 0 && (
            <div style={{ padding: '14px 12px', color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
              No saved hosts. Add one in Settings.
            </div>
          )}
          {hosts.map((h) => (
            <div
              key={h.id}
              role="option"
              aria-selected={h.id === activeId}
              className="ns-hostpicker-item"
              data-active={h.id === activeId}
            >
              <button
                className="ns-hostpicker-item__main"
                onClick={() => { onSelect(h.id); setOpen(false); }}
                style={{ flex: 1 }}
              >
                <span className="ns-hostpicker__dot" data-status={h.id === activeId ? status : 'disconnected'} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {labelFor(h)}
                </span>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', marginLeft: 'auto' }}>
                  {h.username}@{h.host}
                </span>
              </button>
            </div>
          ))}

          {hosts.length > 0 && <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '4px 0' }} />}

          {onOpenSettings && (
            <button
              className="ns-hostpicker-item__main"
              style={{ width: '100%', color: 'var(--accent)' }}
              onClick={() => { setOpen(false); onOpenSettings(); }}
            >
              <Icon name="settings" size={14} />
              <span>Manage Hosts…</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
