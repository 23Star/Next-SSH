// Dashboard: live overview of the selected host.
//
// Pulls SystemInfo via the same code path the AI agent uses, then renders it
// as cards. Nothing here is AI-mediated — the user sees raw, authoritative
// data. The AI drawer (when opened) can reason over the *same* snapshot.
//
// Three states: no host selected, loading, ready. Errors render inline on the
// page header so the layout doesn't collapse when SSH is briefly flaky.

import React from 'react';
import { Card } from '../components/Card';
import { Gauge } from '../components/Gauge';
import { ProgressBar } from '../components/ProgressBar';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { formatBytes, formatCount, formatPercent, percentToTone } from '../lib/format';
import type { SystemSnapshot } from '../../agent/tools/SystemInfo';

export interface DashboardProps {
  connectionId: number | null;
  connStatus: string;
  connError: string | null;
  snapshot: SystemSnapshot | null;
  loading: boolean;
  snapshotError: string | null;
}

export function Dashboard({ connectionId, connStatus, connError, snapshot, loading, snapshotError }: DashboardProps): React.ReactElement {
  const error = snapshotError;

  if (connectionId == null) {
    return (
      <div className="ns-page">
        <div className="ns-page__header">
          <div>
            <h1 className="ns-page__title">Dashboard</h1>
            <div className="ns-page__subtitle">Pick a host from the top bar to get started.</div>
          </div>
        </div>
        <EmptyState
          icon="plug"
          title={connStatus === 'connecting' ? 'Connecting…' : 'No host selected'}
          description={
            connError
              ? `Last error: ${connError}`
              : 'Your saved hosts live in the top bar. Select one and the dashboard will populate with live signals.'
          }
        />
      </div>
    );
  }

  if (loading && !snapshot) {
    return (
      <div className="ns-page">
        <div className="ns-page__header">
          <div>
            <h1 className="ns-page__title">Dashboard</h1>
            <div className="ns-page__subtitle">Collecting system snapshot…</div>
          </div>
        </div>
        <div className="ns-grid ns-grid--dash" aria-busy>
          <SkeletonCard col={4} />
          <SkeletonCard col={4} />
          <SkeletonCard col={4} />
          <SkeletonCard col={8} />
          <SkeletonCard col={4} />
        </div>
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div className="ns-page">
        <div className="ns-page__header">
          <div>
            <h1 className="ns-page__title">Dashboard</h1>
            <div className="ns-page__subtitle">Couldn't collect a snapshot.</div>
          </div>
        </div>
        <EmptyState icon="close" title="Snapshot failed" description={error} />
      </div>
    );
  }

  if (!snapshot) return <div className="ns-page" />;

  const mem = snapshot.memoryBytes;
  const memUsed = mem ? mem.total - mem.available : 0;
  const memPercent = mem && mem.total > 0 ? (memUsed / mem.total) * 100 : 0;

  const load1 = snapshot.loadAvg?.[0] ?? null;
  const cpuCores = snapshot.cpuCores ?? null;
  // Derive a rough "CPU load" percent from load1 / cores. It's not instant
  // utilization, but it's the standard Linux signal and it matches what the AI
  // sees in the text snapshot, so the two stay consistent.
  const cpuPercent = load1 != null && cpuCores ? Math.min(100, (load1 / cpuCores) * 100) : 0;

  return (
    <div className="ns-page">
      <div className="ns-page__header">
        <div>
          <h1 className="ns-page__title">{snapshot.hostname}</h1>
          <div className="ns-page__subtitle">
            {snapshot.os} · kernel {snapshot.kernel} · up {snapshot.uptime}
          </div>
        </div>
      </div>

      <div className="ns-grid ns-grid--dash">
        <Card title="CPU load" col={4} caption={snapshot.cpu.modelName ?? undefined}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Gauge percent={cpuPercent} label={`${cpuCores ?? '?'} cores`} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <LoadRow label="1 min"  value={snapshot.loadAvg?.[0]} />
              <LoadRow label="5 min"  value={snapshot.loadAvg?.[1]} />
              <LoadRow label="15 min" value={snapshot.loadAvg?.[2]} />
            </div>
          </div>
        </Card>

        <Card title="Memory" col={4} caption={mem ? `${formatBytes(mem.total)} total` : undefined}>
          <div className="ns-card__value">
            {formatPercent(memPercent)}
            <span className="ns-card__unit">used</span>
          </div>
          <ProgressBar percent={memPercent} />
          <div className="ns-card__caption">
            {mem ? `${formatBytes(memUsed)} of ${formatBytes(mem.total)}` : '—'}
            {mem ? ` · ${formatBytes(mem.available)} available` : ''}
          </div>
        </Card>

        <Card title="Processes" col={4}>
          <div className="ns-card__value">
            {formatCount(snapshot.processCount ?? 0)}
            <span className="ns-card__unit">running</span>
          </div>
          <div className="ns-card__caption">
            {snapshot.listeningPorts.length} listening port
            {snapshot.listeningPorts.length === 1 ? '' : 's'}
          </div>
        </Card>

        <Card title="Storage" col={8}>
          {snapshot.disks.length === 0 ? (
            <div className="ns-card__caption">No filesystems reported.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {snapshot.disks.map((d) => (
                <DiskRow key={`${d.fs}:${d.mount}`} disk={d} />
              ))}
            </div>
          )}
        </Card>

        <Card title="Listening ports" col={4}>
          {snapshot.listeningPorts.length === 0 ? (
            <div className="ns-card__caption">Nothing listening.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
              {snapshot.listeningPorts.slice(0, 24).map((p, i) => (
                <div
                  key={`${p.proto}-${p.port}-${p.address}-${i}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 'var(--fs-sm)' }}
                >
                  <span className="ns-tag" data-tone={p.proto}>{p.proto.toUpperCase()}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{p.port}</span>
                  <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.process ?? p.address}
                  </span>
                </div>
              ))}
              {snapshot.listeningPorts.length > 24 && (
                <div className="ns-card__caption">(+{snapshot.listeningPorts.length - 24} more)</div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function LoadRow({ label, value }: { label: string; value: number | undefined }): React.ReactElement {
  return (
    <div style={{ display: 'flex', gap: 10, fontSize: 'var(--fs-sm)' }}>
      <span style={{ color: 'var(--text-muted)', minWidth: 46 }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
        {value != null ? value.toFixed(2) : '—'}
      </span>
    </div>
  );
}

function DiskRow({ disk }: { disk: { mount: string; fs: string; totalBytes: number; usedBytes: number; usePercent: number } }): React.ReactElement {
  const tone = percentToTone(disk.usePercent);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}>
          <Icon name="files" size={14} />
          <span style={{ fontWeight: 'var(--fw-medium)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {disk.mount}
          </span>
          <span className="ns-card__caption" style={{ fontFamily: 'var(--font-mono)' }}>{disk.fs}</span>
        </div>
        <div className="ns-card__caption" style={{ whiteSpace: 'nowrap' }}>
          {formatBytes(disk.usedBytes)} / {formatBytes(disk.totalBytes)} · {disk.usePercent}%
        </div>
      </div>
      <ProgressBar percent={disk.usePercent} tone={tone} />
    </div>
  );
}

function SkeletonCard({ col }: { col: 3 | 4 | 6 | 8 | 12 }): React.ReactElement {
  return (
    <div className="ns-card" data-col={col} style={{ minHeight: 140 }}>
      <div style={{ height: 10, width: 80, borderRadius: 4, background: 'var(--bg-elevated)' }} />
      <div style={{ height: 28, width: 140, borderRadius: 6, background: 'var(--bg-elevated)' }} />
      <div style={{ height: 6, width: '100%', borderRadius: 999, background: 'var(--bg-elevated)' }} />
    </div>
  );
}
