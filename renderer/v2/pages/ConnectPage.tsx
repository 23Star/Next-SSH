// Connect page — unified login screen shown when no SSH connection is active.
//
// Lists saved hosts with "Connect" buttons and provides an inline form
// for adding a new host. On successful connection, the parent (App)
// transitions to the main layout.

import React, { useCallback, useState } from 'react';
import { Icon } from '../components/Icon';
import { getApi, type Environment } from '../lib/electron';
import type { ConnStatus } from '../shell/HostPicker';
import logoUrl from '../assets/logo.png';

interface ConnectPageProps {
  hosts: Environment[];
  connStatus: ConnStatus;
  connError: string | null;
  onSelectHost: (id: number | null) => void;
}

interface HostForm {
  name: string;
  host: string;
  port: string;
  username: string;
  authType: string;
  password: string;
  privateKeyPath: string;
}

const emptyForm: HostForm = {
  name: '',
  host: '',
  port: '22',
  username: 'root',
  authType: 'password',
  password: '',
  privateKeyPath: '',
};

function formToInput(f: HostForm): Record<string, unknown> {
  return {
    name: f.name.trim() || null,
    host: f.host.trim(),
    port: Number(f.port) || 22,
    username: f.username.trim(),
    authType: f.authType,
    password: f.authType === 'password' ? f.password || null : null,
    privateKeyPath: f.authType === 'key' ? f.privateKeyPath.trim() || null : null,
    memo: null,
  };
}

function hostLabel(env: Environment): string {
  return env.name?.trim() || `${env.username}@${env.host}`;
}

export function ConnectPage({ hosts, connStatus, connError, onSelectHost }: ConnectPageProps): React.ReactElement {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<HostForm>({ ...emptyForm });
  const [formError, setFormError] = useState<string | null>(null);
  const [formSaving, setFormSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [connectingId, setConnectingId] = useState<number | null>(null);

  const updateField = (key: keyof HostForm, value: string): void => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFormError(null);
    setTestResult(null);
  };

  const handleSave = useCallback(async (): Promise<void> => {
    if (!form.host.trim()) {
      setFormError('主机地址不能为空');
      return;
    }
    setFormSaving(true);
    setFormError(null);
    try {
      const api = getApi();
      await api.environment.create(formToInput(form));
      setForm({ ...emptyForm });
      setAdding(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setFormSaving(false);
    }
  }, [form]);

  const handleTest = useCallback(async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    try {
      const api = getApi();
      const ok = await api.environment.testConnection(form.host.trim(), Number(form.port) || 22);
      setTestResult({ ok, msg: ok ? '连接成功' : '连接失败' });
    } catch (err) {
      setTestResult({ ok: false, msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }, [form]);

  const handleConnect = (env: Environment): void => {
    setConnectingId(env.id);
    onSelectHost(env.id);
  };

  const isConnecting = connStatus === 'connecting';

  return (
    <div className="ns-connect-page">
      <div className="ns-connect-card">
        <div className="ns-connect-header">
          <img className="ns-connect-brand" src={logoUrl} alt="Next Panel" />
          <h1 className="ns-connect-title">Next Panel</h1>
          <p className="ns-connect-subtitle">AI 驱动的 SSH 管理面板</p>
        </div>

        {connError && (
          <div className="ns-msg ns-msg--system" data-tone="error" style={{ marginBottom: 'var(--s-4)' }}>
            <span>{connError}</span>
          </div>
        )}

        {/* Saved hosts */}
        {hosts.length > 0 && (
          <div className="ns-connect-hosts">
            <h3 className="ns-card__title" style={{ marginBottom: 'var(--s-3)' }}>已保存主机</h3>
            <div className="ns-connect-host-list">
              {hosts.map((env) => (
                <button
                  key={env.id}
                  className="ns-connect-host-item"
                  onClick={() => handleConnect(env)}
                  disabled={isConnecting}
                >
                  <div className="ns-connect-host-info">
                    <span className="ns-connect-host-name">{hostLabel(env)}</span>
                    <span className="ns-connect-host-detail">
                      {env.username}@{env.host}:{env.port}
                      <span className="ns-tag" style={{ marginLeft: 8 }}>
                        {env.authType === 'key' ? '密钥' : '密码'}
                      </span>
                    </span>
                  </div>
                  <div className="ns-connect-host-action">
                    {connectingId === env.id && isConnecting ? (
                      <span style={{ color: 'var(--warn)', fontSize: 'var(--fs-sm)' }}>连接中...</span>
                    ) : (
                      <Icon name="chevronRight" size={16} />
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Add host form */}
        {adding ? (
          <div className="ns-connect-form">
            <h3 className="ns-card__title" style={{ marginBottom: 'var(--s-3)' }}>添加新主机</h3>
            {formError && (
              <div className="ns-msg ns-msg--system" data-tone="error" style={{ marginBottom: 'var(--s-3)' }}>
                <span>{formError}</span>
              </div>
            )}
            <div className="ns-connect-form-grid">
              <div style={{ gridColumn: 'span 2' }}>
                <label className="ns-connect-label">名称</label>
                <input className="ns-input" placeholder="我的服务器" value={form.name} onChange={(e) => updateField('name', e.target.value)} />
              </div>
              <div>
                <label className="ns-connect-label">主机 *</label>
                <input className="ns-input" placeholder="192.168.1.1" value={form.host} onChange={(e) => updateField('host', e.target.value)} />
              </div>
              <div>
                <label className="ns-connect-label">端口</label>
                <input className="ns-input" placeholder="22" value={form.port} onChange={(e) => updateField('port', e.target.value)} />
              </div>
              <div>
                <label className="ns-connect-label">用户名</label>
                <input className="ns-input" placeholder="root" value={form.username} onChange={(e) => updateField('username', e.target.value)} />
              </div>
              <div>
                <label className="ns-connect-label">认证方式</label>
                <select className="ns-input" value={form.authType} onChange={(e) => updateField('authType', e.target.value)}>
                  <option value="password">密码</option>
                  <option value="key">私钥</option>
                </select>
              </div>
              {form.authType === 'password' && (
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="ns-connect-label">密码</label>
                  <input className="ns-input" type="password" placeholder="输入密码" value={form.password} onChange={(e) => updateField('password', e.target.value)} />
                </div>
              )}
              {form.authType === 'key' && (
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="ns-connect-label">私钥路径</label>
                  <input className="ns-input" placeholder="~/.ssh/id_rsa" value={form.privateKeyPath} onChange={(e) => updateField('privateKeyPath', e.target.value)} />
                </div>
              )}
            </div>
            {testResult && (
              <div className="ns-msg ns-msg--system" data-tone={testResult.ok ? 'ok' : 'error'} style={{ marginTop: 'var(--s-2)' }}>
                <span>{testResult.msg}</span>
              </div>
            )}
            <div style={{ display: 'flex', gap: 'var(--s-2)', marginTop: 'var(--s-4)' }}>
              <button className="ns-btn" data-variant="primary" onClick={() => void handleSave()} disabled={formSaving || !form.host.trim()}>
                {formSaving ? '保存中...' : '添加主机'}
              </button>
              <button className="ns-btn" onClick={() => void handleTest()} disabled={testing || !form.host.trim()}>
                {testing ? '测试中...' : '测试连接'}
              </button>
              <button className="ns-btn" data-variant="ghost" onClick={() => { setAdding(false); setForm({ ...emptyForm }); setFormError(null); setTestResult(null); }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button className="ns-btn" style={{ marginTop: 'var(--s-4)', width: '100%', justifyContent: 'center' }} onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} /> 添加新主机
          </button>
        )}
      </div>
    </div>
  );
}
