// 防火墙页面 — 检测、开关、规则管理。
//
// 自动检测 UFW / firewalld / iptables，显示状态，支持开关和增添规则。
// 所有操作通过 terminal:exec 执行 sudo 命令。

import React, { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { getTerminal } from '../lib/electron';
import { getCachedFirewall, CACHE_KEYS } from '../lib/usePreload';
import { writeCache } from '../lib/cache';

interface FirewallProps {
  connectionId: number | null;
  connStatus: string;
  refreshTick: number;
}

type FirewallType = 'ufw' | 'firewalld' | 'iptables' | 'none' | 'unknown';

interface FirewallState {
  type: FirewallType;
  active: boolean | null; // null = unknown
  defaultPolicy: string;
  rules: string;
}

export function Firewall({ connectionId, connStatus, refreshTick }: FirewallProps): React.ReactElement {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fwState, setFwState] = useState<FirewallState>({ type: 'unknown', active: null, defaultPolicy: '', rules: '' });
  const [actionLoading, setActionLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addRule, setAddRule] = useState({ action: 'allow', port: '', proto: 'tcp', from: '' });

  const canUse = connectionId != null && connStatus === 'connected';

  const load = useCallback(async () => {
    if (!canUse || connectionId == null) return;
    setLoading(true);
    setError(null);
    try {
      const term = getTerminal();

      // 检测防火墙类型
      const detectRes = await term.exec(connectionId, [
        'command -v ufw >/dev/null 2>&1 && echo "HAS_UFW" || true',
        'command -v firewall-cmd >/dev/null 2>&1 && echo "HAS_FIREWALLD" || true',
        'command -v iptables >/dev/null 2>&1 && echo "HAS_IPTABLES" || true',
      ].join('; '), 15000);
      const detectOut = detectRes.stdout || '';
      writeCache(CACHE_KEYS.firewall, detectOut);

      let fwType: FirewallType = 'none';
      if (detectOut.includes('HAS_UFW')) fwType = 'ufw';
      else if (detectOut.includes('HAS_FIREWALLD')) fwType = 'firewalld';
      else if (detectOut.includes('HAS_IPTABLES')) fwType = 'iptables';

      if (fwType === 'none') {
        setFwState({ type: 'none', active: null, defaultPolicy: '', rules: '' });
        setLoading(false);
        return;
      }

      // 获取状态和规则
      let active: boolean | null = null;
      let defaultPolicy = '';
      let rules = '';

      if (fwType === 'ufw') {
        const statusRes = await term.exec(connectionId, 'sudo -n ufw status verbose 2>&1', 15000);
        const statusText = statusRes.stdout || statusRes.stderr || '';
        active = statusText.toLowerCase().includes('active');
        const policyMatch = statusText.match(/Default:\s*(\S+)/i);
        defaultPolicy = policyMatch ? policyMatch[1] : '';
        rules = statusText;
      } else if (fwType === 'firewalld') {
        const stateRes = await term.exec(connectionId, 'sudo -n firewall-cmd --state 2>&1', 10000);
        const stateText = (stateRes.stdout || stateRes.stderr || '').trim();
        active = stateText.toLowerCase().includes('running');
        const listRes = await term.exec(connectionId, 'sudo -n firewall-cmd --list-all 2>&1', 15000);
        rules = (listRes.stdout || listRes.stderr || '').trim();
        defaultPolicy = active ? 'running' : 'not running';
      } else if (fwType === 'iptables') {
        const listRes = await term.exec(connectionId, 'sudo -n iptables -L -n --line-numbers 2>&1', 15000);
        rules = (listRes.stdout || listRes.stderr || '').trim();
        active = rules.length > 0 && !rules.toLowerCase().includes('command not found');
        const policyRes = await term.exec(connectionId, 'sudo -n iptables -S 2>&1 | grep "^-P" | head -5', 10000);
        defaultPolicy = (policyRes.stdout || '').trim();
      }

      setFwState({ type: fwType, active, defaultPolicy, rules });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [canUse, connectionId]);

  useEffect(() => {
    // Seed from cache if available
    const cached = getCachedFirewall();
    if (cached) {
      let fwType: FirewallType = 'none';
      if (cached.includes('HAS_UFW')) fwType = 'ufw';
      else if (cached.includes('HAS_FIREWALLD')) fwType = 'firewalld';
      else if (cached.includes('HAS_IPTABLES')) fwType = 'iptables';
      if (fwType !== 'none') {
        setFwState((prev) => prev.type === 'unknown' ? { ...prev, type: fwType } : prev);
      } else {
        setFwState({ type: 'none', active: null, defaultPolicy: '', rules: '' });
      }
    }
    void load();
  }, [load, refreshTick]);

  const runAction = async (cmd: string): Promise<void> => {
    if (!connectionId) return;
    setActionLoading(true);
    setError(null);
    try {
      const term = getTerminal();
      const res = await term.exec(connectionId, cmd, 20000);
      if (res.exitCode !== 0 && res.exitCode !== null) {
        throw new Error(res.stderr || `Exit code ${res.exitCode}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggle = (): void => {
    const cmd = fwState.type === 'ufw'
      ? fwState.active
        ? 'sudo -n ufw disable 2>&1'
        : 'sudo -n ufw --force enable 2>&1'
      : fwState.type === 'firewalld'
        ? fwState.active
          ? 'sudo -n systemctl stop firewalld 2>&1'
          : 'sudo -n systemctl start firewalld 2>&1'
        : '';
    if (cmd) void runAction(cmd);
  };

  const handleAddRule = (): void => {
    const { action, port, proto, from } = addRule;
    if (!port.trim()) return;
    let cmd = '';
    if (fwState.type === 'ufw') {
      const fromPart = from.trim() ? ` from ${from.trim()}` : '';
      cmd = `sudo -n ufw ${action} ${port.trim()}/${proto}${fromPart} 2>&1`;
    } else if (fwState.type === 'firewalld') {
      cmd = `sudo -n firewall-cmd --permanent --add-port=${port.trim()}/${proto} 2>&1 && sudo -n firewall-cmd --reload 2>&1`;
    } else if (fwState.type === 'iptables') {
      const policy = action === 'allow' ? 'ACCEPT' : 'DROP';
      const fromPart = from.trim() ? ` -s ${from.trim()}` : '';
      cmd = `sudo -n iptables -A INPUT -p ${proto} --dport ${port.trim()}${fromPart} -j ${policy} 2>&1`;
    }
    if (cmd) {
      void runAction(cmd);
      setShowAddForm(false);
      setAddRule({ action: 'allow', port: '', proto: 'tcp', from: '' });
    }
  };

  const fwTypeLabel: Record<FirewallType, string> = {
    ufw: 'UFW',
    firewalld: 'firewalld',
    iptables: 'iptables',
    none: '无',
    unknown: '检测中…',
  };

  if (!canUse) {
    return (
      <div className="ns-page">
        <div className="ns-page__header">
          <div>
            <h1 className="ns-page__title">防火墙</h1>
            <div className="ns-page__subtitle">检测和管理服务器防火墙</div>
          </div>
        </div>
        <EmptyState icon="firewall" title="请选择并连接一台主机" description="防火墙面板检测并管理远程服务器的防火墙规则" />
      </div>
    );
  }

  return (
    <div className="ns-page">
      <div className="ns-page__header">
        <div>
          <h1 className="ns-page__title">防火墙</h1>
          <div className="ns-page__subtitle">
            {fwTypeLabel[fwState.type]}
            {fwState.active !== null && ` · ${fwState.active ? '已启用' : '未启用'}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'center' }}>
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

      {loading ? (
        <div className="ns-card" style={{ padding: 'var(--s-6)', textAlign: 'center', color: 'var(--text-muted)' }}>
          正在检测防火墙…
        </div>
      ) : fwState.type === 'none' ? (
        <div className="ns-card" style={{ padding: 'var(--s-6)', textAlign: 'center' }}>
          <Icon name="firewall" size={24} />
          <div style={{ marginTop: 'var(--s-3)', fontWeight: 'var(--fw-semibold)' }}>未检测到防火墙</div>
          <div className="ns-card__caption" style={{ marginTop: 'var(--s-2)' }}>
            未找到 ufw、firewalld 或 iptables，请先安装防火墙工具
          </div>
        </div>
      ) : (
        <>
          {/* 状态概要 */}
          <div className="ns-grid ns-grid--dash" style={{ marginBottom: 'var(--s-4)' }}>
            <section className="ns-card" data-col="4">
              <h3 className="ns-card__title">防火墙类型</h3>
              <div className="ns-card__value">{fwTypeLabel[fwState.type]}</div>
              <div className="ns-card__caption">
                {fwState.defaultPolicy ? `默认策略: ${fwState.defaultPolicy}` : ''}
              </div>
            </section>
            <section className="ns-card" data-col="4">
              <h3 className="ns-card__title">状态</h3>
              <div className="ns-card__value">
                <span className="ns-tag" data-tone={fwState.active ? 'ok' : 'udp'}>
                  {fwState.active ? '已启用' : '未启用'}
                </span>
              </div>
            </section>
            <section className="ns-card" data-col="4">
              <h3 className="ns-card__title">操作</h3>
              <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
                <button
                  className="ns-btn"
                  data-variant={fwState.active ? 'ghost' : 'primary'}
                  onClick={handleToggle}
                  disabled={actionLoading}
                >
                  {fwState.active ? '关闭防火墙' : '启用防火墙'}
                </button>
                <button
                  className="ns-btn"
                  onClick={() => setShowAddForm((v) => !v)}
                  disabled={!fwState.active || actionLoading}
                >
                  <Icon name="plus" size={14} /> 添加规则
                </button>
              </div>
            </section>
          </div>

          {/* 添加规则表单 */}
          {showAddForm && (
            <div className="ns-card" style={{ marginBottom: 'var(--s-4)' }}>
              <h3 className="ns-card__title">添加规则</h3>
              <div style={{ display: 'flex', gap: 'var(--s-3)', flexWrap: 'wrap', alignItems: 'end' }}>
                <div>
                  <label className="ns-card__caption" style={{ display: 'block', marginBottom: 4 }}>策略</label>
                  <select
                    className="ns-input"
                    value={addRule.action}
                    onChange={(e) => setAddRule((r) => ({ ...r, action: e.target.value }))}
                    style={{ width: 100 }}
                  >
                    <option value="allow">允许</option>
                    <option value="deny">拒绝</option>
                  </select>
                </div>
                <div>
                  <label className="ns-card__caption" style={{ display: 'block', marginBottom: 4 }}>端口</label>
                  <input
                    className="ns-input"
                    placeholder="80 或 8080:8090"
                    value={addRule.port}
                    onChange={(e) => setAddRule((r) => ({ ...r, port: e.target.value }))}
                    style={{ width: 140 }}
                  />
                </div>
                <div>
                  <label className="ns-card__caption" style={{ display: 'block', marginBottom: 4 }}>协议</label>
                  <select
                    className="ns-input"
                    value={addRule.proto}
                    onChange={(e) => setAddRule((r) => ({ ...r, proto: e.target.value }))}
                    style={{ width: 80 }}
                  >
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                  </select>
                </div>
                <div>
                  <label className="ns-card__caption" style={{ display: 'block', marginBottom: 4 }}>来源 IP（可选）</label>
                  <input
                    className="ns-input"
                    placeholder="如 192.168.1.0/24"
                    value={addRule.from}
                    onChange={(e) => setAddRule((r) => ({ ...r, from: e.target.value }))}
                    style={{ width: 160 }}
                  />
                </div>
                <button
                  className="ns-btn"
                  data-variant="primary"
                  onClick={handleAddRule}
                  disabled={!addRule.port.trim() || actionLoading}
                >
                  确认添加
                </button>
              </div>
            </div>
          )}

          {/* 规则列表 */}
          <section className="ns-card">
            <h3 className="ns-card__title">当前规则</h3>
            <pre className="ns-tool__pre" style={{ maxHeight: 500 }}>
              {fwState.rules || '无规则数据'}
            </pre>
          </section>
        </>
      )}
    </div>
  );
}
