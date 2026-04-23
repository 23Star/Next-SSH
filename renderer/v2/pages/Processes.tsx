// Processes page — live process monitor.
//
// Displays a sortable table of running processes similar to top/htop.
// Supports auto-refresh intervals. Data fetched via terminal:exec.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { getTerminal } from '../lib/electron';
import { formatBytes } from '../lib/format';
import { getCachedProcesses, CACHE_KEYS } from '../lib/usePreload';
import { writeCache } from '../lib/cache';

interface ProcessesProps {
  connectionId: number | null;
  connStatus: string;
  refreshTick: number;
}

interface ProcessRow {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  vsz: number;
  rss: number;
  stat: string;
  start: string;
  command: string;
}

type SortKey = 'pid' | 'user' | 'cpu' | 'mem' | 'rss' | 'stat' | 'command';
type SortDir = 'asc' | 'desc';

interface Summary {
  cpuTotal: number;
  memTotal: number;
  memUsed: number;
  processCount: number;
}

function parsePsOutput(stdout: string): ProcessRow[] {
  const lines = stdout.split(/\r?\n/).slice(1); // skip header
  const rows: ProcessRow[] = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 10) continue;
    rows.push({
      pid: parseInt(parts[0], 10) || 0,
      user: parts[1],
      cpu: parseFloat(parts[2]) || 0,
      mem: parseFloat(parts[3]) || 0,
      vsz: parseInt(parts[4], 10) || 0,
      rss: parseInt(parts[5], 10) || 0,
      stat: parts[7],
      start: parts[8],
      command: parts.slice(9).join(' '),
    });
  }
  return rows;
}

function parseSummary(stdout: string): Summary {
  const lines = stdout.split(/\r?\n/);
  let cpuTotal = 0;
  let memTotal = 0;
  let memUsed = 0;
  let processCount = 0;

  for (const line of lines) {
    // CPU used = 100 - id (idle)
    const cpuIdleMatch = line.match(/%Cpu\(s\):.*?([\d.]+)\s+id/);
    if (cpuIdleMatch) cpuTotal = Math.round((100 - parseFloat(cpuIdleMatch[1])) * 10) / 10;

    // MiB Mem :   7823.2 total,    256.1 free,   3456.7 used,   4110.4 buff/cache
    const memMatch = line.match(/Mem\s*:\s+([\d.]+)\s+total.*?([\d.]+)\s+used/);
    if (memMatch) {
      memTotal = parseFloat(memMatch[1]);
      memUsed = parseFloat(memMatch[2]);
    }

    // Tasks: 186 total, 2 running
    const taskMatch = line.match(/Tasks:\s+(\d+)\s+total/);
    if (taskMatch) processCount = parseInt(taskMatch[1], 10);
  }

  return { cpuTotal, memTotal, memUsed, processCount };
}

export function Processes({ connectionId, connStatus, refreshTick }: ProcessesProps): React.ReactElement {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processes, setProcesses] = useState<ProcessRow[]>([]);
  const [summary, setSummary] = useState<Summary>({ cpuTotal: 0, memTotal: 0, memUsed: 0, processCount: 0 });
  const [sortKey, setSortKey] = useState<SortKey>('cpu');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [autoRefresh, setAutoRefresh] = useState<number>(0); // 0=off, ms interval
  const [filter, setFilter] = useState('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const canUse = connectionId != null && connStatus === 'connected';

  const load = useCallback(async () => {
    if (!canUse || connectionId == null) return;
    setLoading(true);
    setError(null);
    try {
      const term = getTerminal();
      const [psRes, topRes] = await Promise.all([
        term.exec(
          connectionId,
          'ps -eo pid,user,%cpu,%mem,vsz,rss,tty,stat,start,command --sort=-%cpu 2>/dev/null | head -n 101',
          20000,
        ),
        term.exec(connectionId, 'top -b -n 1 2>/dev/null | head -n 10', 15000),
      ]);
      const psOut = psRes.stdout || '';
      const topOut = topRes.stdout || '';
      writeCache(CACHE_KEYS.processes, psOut);
      writeCache(CACHE_KEYS.processesSummary, topOut);
      setProcesses(parsePsOutput(psOut));
      setSummary(parseSummary(topOut));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('timeout') || msg.includes('Timeout')) {
        setError('请求超时：服务器响应时间过长，请检查网络连接后重试');
      } else {
        setError(`加载进程数据失败：${msg}`);
      }
    } finally {
      setLoading(false);
    }
  }, [canUse, connectionId]);

  useEffect(() => {
    // Seed from cache first
    const cached = getCachedProcesses();
    if (cached) {
      setProcesses(parsePsOutput(cached.ps));
      setSummary(parseSummary(cached.summary));
    }
    void load();
  }, [load, refreshTick]);

  // Auto-refresh timer
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (autoRefresh > 0) {
      intervalRef.current = setInterval(() => void load(), autoRefresh);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, load]);

  const handleSort = (key: SortKey): void => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sorted = useMemo(() => {
    const filtered = filter
      ? processes.filter(
          (p) =>
            p.command.toLowerCase().includes(filter.toLowerCase()) ||
            p.user.toLowerCase().includes(filter.toLowerCase()) ||
            String(p.pid).includes(filter),
        )
      : processes;

    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [processes, sortKey, sortDir, filter]);

  const memPercent = summary.memTotal > 0 ? (summary.memUsed / summary.memTotal) * 100 : 0;

  if (!canUse) {
    return (
      <div className="ns-page">
        <div className="ns-page__header">
          <div>
            <h1 className="ns-page__title">进程</h1>
            <div className="ns-page__subtitle">实时进程监控</div>
          </div>
        </div>
        <EmptyState
          icon="processes"
          title="请选择并连接一台主机"
          description="查看远程服务器上运行的进程"
        />
      </div>
    );
  }

  return (
    <div className="ns-page">
      <div className="ns-page__header">
        <div>
          <h1 className="ns-page__title">进程</h1>
          <div className="ns-page__subtitle">
            {summary.processCount > 0 ? `${summary.processCount} 个进程` : '加载中...'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'center' }}>
          <select
            className="ns-input"
            style={{ width: 'auto', fontSize: 'var(--fs-sm)' }}
            value={autoRefresh}
            onChange={(e) => setAutoRefresh(Number(e.target.value))}
          >
            <option value={0}>自动刷新: 关闭</option>
            <option value={5000}>每 5 秒</option>
            <option value={10000}>每 10 秒</option>
            <option value={15000}>每 15 秒</option>
          </select>
          <button className="ns-btn" onClick={() => void load()} disabled={loading}>
            <Icon name="refresh" size={14} /> 刷新
          </button>
        </div>
      </div>

      {error && (
        <div className="ns-msg ns-msg--system" data-tone="error">
          <span>{error}</span>
        </div>
      )}

      {/* Summary cards */}
      <div className="ns-grid ns-grid--dash" style={{ marginBottom: 'var(--s-4)' }}>
        <section className="ns-card" data-col="4">
          <h3 className="ns-card__title">CPU 使用率</h3>
          <div className="ns-card__value">{summary.cpuTotal}%</div>
          <div className="ns-bar">
            <div
              className="ns-bar__fill"
              style={{ width: `${Math.min(summary.cpuTotal, 100)}%` }}
              data-tone={summary.cpuTotal > 80 ? 'danger' : summary.cpuTotal > 50 ? 'warn' : 'success'}
            />
          </div>
        </section>
        <section className="ns-card" data-col="4">
          <h3 className="ns-card__title">内存</h3>
          <div className="ns-card__value">
            {formatBytes(summary.memUsed * 1024 * 1024)}
            <span className="ns-card__unit">/ {formatBytes(summary.memTotal * 1024 * 1024)}</span>
          </div>
          <div className="ns-bar">
            <div
              className="ns-bar__fill"
              style={{ width: `${Math.min(memPercent, 100)}%` }}
              data-tone={memPercent > 85 ? 'danger' : memPercent > 60 ? 'warn' : 'success'}
            />
          </div>
        </section>
        <section className="ns-card" data-col="4">
          <h3 className="ns-card__title">进程</h3>
          <div className="ns-card__value">{summary.processCount || processes.length}</div>
          <div className="ns-card__caption">按 CPU 排序显示前 {processes.length} 个</div>
        </section>
      </div>

      {/* Filter */}
      <div style={{ marginBottom: 'var(--s-3)' }}>
        <div className="ns-search-box">
          <Icon name="search" size={14} />
          <input
            className="ns-search-input"
            placeholder="按命令、用户或 PID 筛选..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      {/* Process table */}
      {loading && processes.length === 0 ? (
        <div className="ns-card" style={{ padding: 'var(--s-6)', textAlign: 'center', color: 'var(--text-muted)' }}>
          正在加载进程...
        </div>
      ) : (
        <div className="ns-card" style={{ padding: 0, overflow: 'auto' }}>
          <table className="ns-table">
            <thead>
              <tr>
                {([
                  ['pid', 'PID'],
                  ['user', '用户'],
                  ['cpu', 'CPU%'],
                  ['mem', 'MEM%'],
                  ['rss', 'RSS'],
                  ['stat', '状态'],
                  ['command', '命令'],
                ] as [SortKey, string][]).map(([key, label]) => (
                  <th
                    key={key}
                    onClick={() => handleSort(key)}
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {label}
                      {sortKey === key && (
                        <Icon name={sortDir === 'asc' ? 'sortUp' : 'sortDown'} size={12} />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 100).map((proc) => (
                <tr key={proc.pid}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)' }}>{proc.pid}</td>
                  <td>{proc.user}</td>
                  <td style={{ color: proc.cpu > 50 ? 'var(--danger)' : proc.cpu > 20 ? 'var(--warn)' : 'inherit' }}>
                    {proc.cpu.toFixed(1)}
                  </td>
                  <td style={{ color: proc.mem > 30 ? 'var(--danger)' : proc.mem > 15 ? 'var(--warn)' : 'inherit' }}>
                    {proc.mem.toFixed(1)}
                  </td>
                  <td style={{ fontSize: 'var(--fs-sm)' }}>{formatBytes(proc.rss * 1024)}</td>
                  <td>
                    <span className="ns-tag">{proc.stat}</span>
                  </td>
                  <td
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--fs-sm)',
                      maxWidth: 400,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={proc.command}
                  >
                    {proc.command}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
