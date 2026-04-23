// Docker 容器页面 — 检测 Docker 安装、列出容器状态、支持启停操作。
//
// 自动检测 Docker 是否安装，显示运行中/已停止的容器列表。
// 支持启动、停止、重启容器。所有操作通过 terminal:exec 执行。

import React, { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { getTerminal } from '../lib/electron';
import { getCachedDocker, CACHE_KEYS } from '../lib/usePreload';
import { writeCache } from '../lib/cache';

interface DockerProps {
  connectionId: number | null;
  connStatus: string;
  refreshTick: number;
}

interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
  running: boolean;
}

function parseDockerOutput(stdout: string): { installed: boolean; containers: ContainerInfo[] } {
  const parts = stdout.split('---SEP---').map((s) => s.trim());
  const detectLine = parts[0] || '';
  if (!detectLine.includes('HAS_DOCKER')) return { installed: false, containers: [] };

  const containers: ContainerInfo[] = [];

  // Running containers: docker ps
  const runningLines = (parts[1] || '').split(/\r?\n/).filter((l) => l.includes('|'));
  for (const line of runningLines) {
    const fields = line.split('|');
    if (fields.length >= 4) {
      containers.push({
        id: fields[0].trim().slice(0, 12),
        name: fields[1].trim(),
        image: fields[2].trim(),
        status: fields[3].trim(),
        ports: fields[4]?.trim() || '',
        running: true,
      });
    }
  }

  // Stopped containers: docker ps -a --filter exited
  const stoppedLines = (parts[2] || '').split(/\r?\n/).filter((l) => l.includes('|'));
  for (const line of stoppedLines) {
    const fields = line.split('|');
    if (fields.length >= 4) {
      const id = fields[0].trim().slice(0, 12);
      if (!containers.some((c) => c.id === id)) {
        containers.push({
          id,
          name: fields[1].trim(),
          image: fields[2].trim(),
          status: fields[3].trim(),
          ports: '',
          running: false,
        });
      }
    }
  }

  return { installed: true, containers };
}

export function Docker({ connectionId, connStatus, refreshTick }: DockerProps): React.ReactElement {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [filter, setFilter] = useState('');

  const canUse = connectionId != null && connStatus === 'connected';

  const load = useCallback(async () => {
    if (!canUse || connectionId == null) return;
    setLoading(true);
    setError(null);
    try {
      const term = getTerminal();
      const res = await term.exec(connectionId, [
        'command -v docker >/dev/null 2>&1 && echo "HAS_DOCKER" || echo "NO_DOCKER"',
        'docker ps --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}" 2>/dev/null || true',
        'docker ps -a --filter "status=exited" --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}" 2>/dev/null | head -20 || true',
      ].join('; echo "---SEP---"; '), 25000);
      const stdout = res.stdout || '';
      writeCache(CACHE_KEYS.docker, stdout);
      const parsed = parseDockerOutput(stdout);
      setInstalled(parsed.installed);
      setContainers(parsed.containers);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [canUse, connectionId]);

  useEffect(() => {
    // Seed from cache
    const cached = getCachedDocker();
    if (cached) {
      const parsed = parseDockerOutput(cached);
      if (parsed.installed) {
        setInstalled(true);
        setContainers(parsed.containers);
      }
    }
    void load();
  }, [load, refreshTick]);

  const runAction = async (containerId: string, action: string): Promise<void> => {
    if (connectionId == null) return;
    setActionLoading(true);
    setError(null);
    try {
      const term = getTerminal();
      const cmd = action === 'start'
        ? `docker start ${containerId} 2>&1`
        : action === 'stop'
          ? `docker stop ${containerId} 2>&1`
          : `docker restart ${containerId} 2>&1`;
      const res = await term.exec(connectionId, cmd, 30000);
      if (res.exitCode !== 0 && res.exitCode !== null) {
        throw new Error(res.stderr || `操作失败 (exit code ${res.exitCode})`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(false);
    }
  };

  const filtered = filter
    ? containers.filter((c) =>
        c.name.toLowerCase().includes(filter.toLowerCase()) ||
        c.image.toLowerCase().includes(filter.toLowerCase()) ||
        c.id.includes(filter),
      )
    : containers;

  const runningCount = containers.filter((c) => c.running).length;
  const stoppedCount = containers.length - runningCount;

  if (!canUse) {
    return (
      <div className="ns-page">
        <div className="ns-page__header">
          <div>
            <h1 className="ns-page__title">Docker</h1>
            <div className="ns-page__subtitle">容器管理</div>
          </div>
        </div>
        <EmptyState icon="docker" title="请选择并连接一台主机" description="查看远程服务器上的 Docker 容器状态" />
      </div>
    );
  }

  return (
    <div className="ns-page">
      <div className="ns-page__header">
        <div>
          <h1 className="ns-page__title">Docker</h1>
          <div className="ns-page__subtitle">
            {installed === null ? '检测中…' : installed ? `${containers.length} 个容器 · ${runningCount} 运行中` : '未安装 Docker'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'center' }}>
          <div className="ns-search-box">
            <Icon name="search" size={14} />
            <input
              className="ns-search-input"
              placeholder="筛选容器..."
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

      {loading && containers.length === 0 ? (
        <div className="ns-card" style={{ padding: 'var(--s-6)', textAlign: 'center', color: 'var(--text-muted)' }}>
          正在检测 Docker…
        </div>
      ) : installed === false ? (
        <div className="ns-card" style={{ padding: 'var(--s-6)', textAlign: 'center' }}>
          <Icon name="docker" size={24} />
          <div style={{ marginTop: 'var(--s-3)', fontWeight: 'var(--fw-semibold)' }}>未检测到 Docker</div>
          <div className="ns-card__caption" style={{ marginTop: 'var(--s-2)' }}>
            服务器上未安装 Docker 或当前用户无权限访问。安装: curl -fsSL https://get.docker.com | sh
          </div>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="ns-grid ns-grid--dash" style={{ marginBottom: 'var(--s-4)' }}>
            <section className="ns-card" data-col="4">
              <h3 className="ns-card__title">总容器</h3>
              <div className="ns-card__value">{containers.length}</div>
            </section>
            <section className="ns-card" data-col="4">
              <h3 className="ns-card__title">运行中</h3>
              <div className="ns-card__value" style={{ color: 'var(--success)' }}>{runningCount}</div>
            </section>
            <section className="ns-card" data-col="4">
              <h3 className="ns-card__title">已停止</h3>
              <div className="ns-card__value" style={{ color: 'var(--text-muted)' }}>{stoppedCount}</div>
            </section>
          </div>

          {/* Container table */}
          <div className="ns-card" style={{ padding: 0, overflow: 'auto' }}>
            <table className="ns-table">
              <thead>
                <tr>
                  <th>容器 ID</th>
                  <th>名称</th>
                  <th>镜像</th>
                  <th>状态</th>
                  <th>端口</th>
                  <th style={{ width: 100 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ctr) => (
                  <tr key={ctr.id}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)' }}>{ctr.id}</td>
                    <td style={{ fontWeight: 'var(--fw-medium)' }}>{ctr.name}</td>
                    <td style={{ fontSize: 'var(--fs-sm)' }}>{ctr.image}</td>
                    <td>
                      <span className="ns-tag" data-tone={ctr.running ? 'ok' : 'udp'}>
                        {ctr.running ? '运行中' : '已停止'}
                      </span>
                      <span className="ns-card__caption" style={{ marginLeft: 6 }}>{ctr.status}</span>
                    </td>
                    <td style={{ fontSize: 'var(--fs-xs)', fontFamily: 'var(--font-mono)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ctr.ports || '-'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {ctr.running ? (
                          <button
                            className="ns-btn ns-btn--xs"
                            title="停止"
                            onClick={() => void runAction(ctr.id, 'stop')}
                            disabled={actionLoading}
                          >
                            <Icon name="pause" size={12} />
                          </button>
                        ) : (
                          <button
                            className="ns-btn ns-btn--xs"
                            title="启动"
                            onClick={() => void runAction(ctr.id, 'start')}
                            disabled={actionLoading}
                          >
                            <Icon name="play" size={12} />
                          </button>
                        )}
                        <button
                          className="ns-btn ns-btn--xs"
                          title="重启"
                          onClick={() => void runAction(ctr.id, 'restart')}
                          disabled={actionLoading}
                        >
                          <Icon name="restart" size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && !loading && (
              <div style={{ padding: 'var(--s-6)', textAlign: 'center', color: 'var(--text-muted)' }}>
                暂无容器
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
