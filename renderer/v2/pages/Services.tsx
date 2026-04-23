// Services page — systemd unit management.
//
// Lists all systemd service units with status. Supports start/stop/restart
// actions and live journal log preview. All data fetched via terminal:exec.

import React, { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { getTerminal } from '../lib/electron';
import { getCachedServices, CACHE_KEYS } from '../lib/usePreload';
import { writeCache } from '../lib/cache';

interface ServicesProps {
  connectionId: number | null;
  connStatus: string;
  refreshTick: number;
}

interface ServiceUnit {
  name: string;
  load: string;
  active: string;
  sub: string;
  description: string;
}

const STATUS_TONE: Record<string, string> = {
  active: 'ok',
  failed: 'error',
  inactive: 'udp',
  activating: 'tcp',
  deactivating: 'tcp',
};

function statusTone(active: string): string {
  return STATUS_TONE[active.toLowerCase()] ?? 'udp';
}

export function Services({ connectionId, connStatus, refreshTick }: ServicesProps): React.ReactElement {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [services, setServices] = useState<ServiceUnit[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<string>('');
  const [logs, setLogs] = useState<string>('');
  const [actionLoading, setActionLoading] = useState(false);
  const [filter, setFilter] = useState('');

  const canUse = connectionId != null && connStatus === 'connected';

  const parseServiceOutput = (stdout: string): ServiceUnit[] => {
    const lines = stdout.split(/\r?\n/).filter((l) => l.trim());
    return lines.map((line) => {
      // systemctl list-units output: UNIT LOAD ACTIVE SUB JOB DESCRIPTION
      // First 4 fields are non-space, then optional JOB, then rest is description.
      // Use a regex to reliably split the first 4 columns.
      const match = line.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(?:\S+\s+)?(.*)$/);
      if (!match) {
        return { name: line.split(/\s+/)[0] || '', load: '', active: '', sub: '', description: '' };
      }
      return {
        name: match[1],
        load: match[2],
        active: match[3],
        sub: match[4],
        description: match[5].trim(),
      };
    });
  };

  const load = useCallback(async () => {
    if (!canUse || connectionId == null) return;
    setLoading(true);
    setError(null);
    try {
      const term = getTerminal();
      const res = await term.exec(
        connectionId,
        'systemctl list-units --type=service --all --no-pager --no-legend 2>/dev/null',
        30000,
      );
      const stdout = res.stdout || '';
      writeCache(CACHE_KEYS.services, stdout);
      setServices(parseServiceOutput(stdout));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('permission') || msg.includes('Permission')) {
        setError('权限不足：无法读取服务列表。请确保 SSH 用户有 sudo 权限。');
      } else if (msg.includes('timeout') || msg.includes('Timeout')) {
        setError('请求超时：服务器响应时间过长，请检查网络连接。');
      } else {
        setError(`加载服务列表失败：${msg}`);
      }
    } finally {
      setLoading(false);
    }
  }, [canUse, connectionId]);

  useEffect(() => {
    // Seed from cache first to avoid white flash
    const cached = getCachedServices();
    if (cached) setServices(parseServiceOutput(cached));
    void load();
  }, [load, refreshTick]);

  const loadDetail = useCallback(
    async (name: string) => {
      if (connectionId == null) return;
      setActionLoading(true);
      try {
        const term = getTerminal();
        const [statusRes, logRes] = await Promise.all([
          term.exec(connectionId, `systemctl status '${name}' --no-pager 2>&1`, 15000),
          term.exec(
            connectionId,
            `journalctl -u '${name}' -n 50 --no-pager 2>&1`,
            15000,
          ),
        ]);
        setDetail((statusRes.stdout || statusRes.stderr || '').trim());
        setLogs((logRes.stdout || logRes.stderr || '').trim());
      } catch (err) {
        setDetail(err instanceof Error ? err.message : String(err));
        setLogs('');
      } finally {
        setActionLoading(false);
      }
    },
    [connectionId],
  );

  const toggleExpand = (name: string): void => {
    if (expanded === name) {
      setExpanded(null);
      setDetail('');
      setLogs('');
    } else {
      setExpanded(name);
      void loadDetail(name);
    }
  };

  const runAction = async (name: string, action: string): Promise<void> => {
    if (connectionId == null) return;
    setActionLoading(true);
    try {
      const term = getTerminal();
      await term.exec(connectionId, `sudo systemctl ${action} '${name}' 2>&1`, 20000);
      await loadDetail(name);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes('permission') || msg.includes('Permission')
        ? '权限不足：无法执行服务操作，请确保用户有 sudo 权限'
        : `操作失败：${msg}`);
    } finally {
      setActionLoading(false);
    }
  };

  const filtered = filter
    ? services.filter(
        (s) =>
          s.name.toLowerCase().includes(filter.toLowerCase()) ||
          s.description.toLowerCase().includes(filter.toLowerCase()),
      )
    : services;

  if (!canUse) {
    return (
      <div className="ns-page">
        <div className="ns-page__header">
          <div>
            <h1 className="ns-page__title">服务</h1>
            <div className="ns-page__subtitle">systemd 服务管理</div>
          </div>
        </div>
        <EmptyState
          icon="services"
          title="请选择并连接一台主机"
          description="查看和管理远程服务器上的 systemd 服务。"
        />
      </div>
    );
  }

  return (
    <div className="ns-page">
      <div className="ns-page__header">
        <div>
          <h1 className="ns-page__title">服务</h1>
          <div className="ns-page__subtitle">
            {services.length} 个服务单元
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'center' }}>
          <div className="ns-search-box">
            <Icon name="search" size={14} />
            <input
              className="ns-search-input"
              placeholder="筛选服务..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
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

      {loading && services.length === 0 ? (
        <div className="ns-card" style={{ padding: 'var(--s-6)', textAlign: 'center', color: 'var(--text-muted)' }}>
          正在加载服务...
        </div>
      ) : (
        <div className="ns-services-list">
          <table className="ns-table">
            <thead>
              <tr>
                <th>服务</th>
                <th>状态</th>
                <th>子状态</th>
                <th>描述</th>
                <th style={{ width: 80 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((svc) => (
                <React.Fragment key={svc.name}>
                  <tr
                    onClick={() => toggleExpand(svc.name)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td style={{ minWidth: 200 }}>
                      <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)' }}>
                        {svc.name}
                      </strong>
                    </td>
                    <td>
                      <span className="ns-tag" data-tone={statusTone(svc.active)}>
                        {svc.active}
                      </span>
                    </td>
                    <td style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{svc.sub}</td>
                    <td style={{ color: 'var(--text-muted)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {svc.description}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {svc.active !== 'active' && (
                          <button
                            className="ns-btn ns-btn--xs"
                            title="启动"
                            onClick={(e) => {
                              e.stopPropagation();
                              void runAction(svc.name, 'start');
                            }}
                            disabled={actionLoading}
                          >
                            <Icon name="play" size={12} />
                          </button>
                        )}
                        {svc.active === 'active' && (
                          <button
                            className="ns-btn ns-btn--xs"
                            title="停止"
                            onClick={(e) => {
                              e.stopPropagation();
                              void runAction(svc.name, 'stop');
                            }}
                            disabled={actionLoading}
                          >
                            <Icon name="pause" size={12} />
                          </button>
                        )}
                        <button
                          className="ns-btn ns-btn--xs"
                          title="重启"
                          onClick={(e) => {
                            e.stopPropagation();
                            void runAction(svc.name, 'restart');
                          }}
                          disabled={actionLoading}
                        >
                          <Icon name="restart" size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded === svc.name && (
                    <tr>
                      <td colSpan={5} style={{ padding: 0 }}>
                        <div className="ns-services-detail">
                          <div style={{ display: 'flex', gap: 'var(--s-4)' }}>
                            <div style={{ flex: 1 }}>
                              <h4 className="ns-card__title" style={{ marginBottom: 'var(--s-2)' }}>状态详情</h4>
                              <pre className="ns-tool__pre" style={{ maxHeight: 200 }}>
                                {detail || '加载中...'}
                              </pre>
                            </div>
                            <div style={{ flex: 1 }}>
                              <h4 className="ns-card__title" style={{ marginBottom: 'var(--s-2)' }}>最近日志</h4>
                              <pre className="ns-tool__pre" style={{ maxHeight: 200 }}>
                                {logs || '暂无日志'}
                              </pre>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && !loading && (
            <div style={{ padding: 'var(--s-8)', textAlign: 'center', color: 'var(--text-muted)' }}>
              未找到服务
            </div>
          )}
        </div>
      )}
    </div>
  );
}
