import React, { useCallback, useEffect, useState } from 'react';
import { Card } from '../components/Card';
import { Icon } from '../components/Icon';
import { getApi, type Environment } from '../lib/electron';
import { useEnvironments } from '../lib/useEnvironments';

// ——— Host form data ———

interface HostForm {
  name: string;
  host: string;
  port: string;
  username: string;
  authType: string;
  password: string;
  privateKeyPath: string;
  memo: string;
}

const emptyForm: HostForm = {
  name: '',
  host: '',
  port: '22',
  username: 'root',
  authType: 'password',
  password: '',
  privateKeyPath: '',
  memo: '',
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
    memo: f.memo.trim() || null,
  };
}

function envToForm(env: Environment): HostForm {
  return {
    name: env.name || '',
    host: env.host,
    port: String(env.port),
    username: env.username,
    authType: env.authType,
    password: env.password || '',
    privateKeyPath: env.privateKeyPath || '',
    memo: env.memo || '',
  };
}

// ——— Settings page ———

type SettingsTab = 'hosts' | 'ai' | 'appearance';

export function Settings(): React.ReactElement {
  const [tab, setTab] = useState<SettingsTab>('hosts');

  return (
    <div className="ns-page">
      <div className="ns-page__header">
        <div>
          <h1 className="ns-page__title">Settings</h1>
          <div className="ns-page__subtitle">Manage connections, AI provider, and appearance.</div>
        </div>
      </div>

      <div className="ns-settings-tabs">
        <button className="ns-tab" data-active={tab === 'hosts'} onClick={() => setTab('hosts')}>
          <span className="ns-tab__icon"><Icon name="plug" size={16} /></span>
          <span>SSH Hosts</span>
        </button>
        <button className="ns-tab" data-active={tab === 'ai'} onClick={() => setTab('ai')}>
          <span className="ns-tab__icon"><Icon name="sparkle" size={16} /></span>
          <span>AI Provider</span>
        </button>
        <button className="ns-tab" data-active={tab === 'appearance'} onClick={() => setTab('appearance')}>
          <span className="ns-tab__icon"><Icon name="settings" size={16} /></span>
          <span>Appearance</span>
        </button>
      </div>

      {tab === 'hosts' && <HostsSection />}
      {tab === 'ai' && <AISection />}
      {tab === 'appearance' && <AppearanceSection />}
    </div>
  );
}

// ——— SSH Hosts management ———

function HostsSection(): React.ReactElement {
  const { hosts, refresh } = useEnvironments();
  const [editing, setEditing] = useState<Environment | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<HostForm>(emptyForm);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const startAdd = useCallback(() => {
    setForm(emptyForm);
    setAdding(true);
    setEditing(null);
    setTestResult(null);
  }, []);

  const startEdit = useCallback((env: Environment) => {
    setForm(envToForm(env));
    setEditing(env);
    setAdding(false);
    setTestResult(null);
  }, []);

  const cancel = useCallback(() => {
    setAdding(false);
    setEditing(null);
    setForm(emptyForm);
    setTestResult(null);
  }, []);

  const save = useCallback(async () => {
    const api = getApi();
    const input = formToInput(form);
    if (editing) {
      await api.environment.update(editing.id, input);
    } else {
      await api.environment.create(input);
    }
    cancel();
    await refresh();
  }, [editing, form, cancel, refresh]);

  const remove = useCallback(async (id: number) => {
    if (!confirm('Delete this host?')) return;
    const api = getApi();
    await api.environment.delete(id);
    await refresh();
  }, [refresh]);

  const testConn = useCallback(async () => {
    const api = getApi();
    const ok = await api.environment.testConnection(form.host.trim(), Number(form.port) || 22);
    setTestResult({ ok, msg: ok ? 'Connection successful' : 'Connection failed' });
    setTimeout(() => setTestResult(null), 3000);
  }, [form.host, form.port]);

  const update = (key: keyof HostForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  // List view
  if (!adding && !editing) {
    return (
      <div className="ns-settings-hosts">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-semibold)' }}>
            Saved Hosts ({hosts.length})
          </span>
          <button className="ns-btn" data-variant="primary" onClick={startAdd}>
            <Icon name="send" size={14} /> Add Host
          </button>
        </div>

        {hosts.length === 0 ? (
          <div className="ns-empty" style={{ padding: 'var(--s-10)' }}>
            <div className="ns-empty__icon"><Icon name="plug" size={20} /></div>
            <p className="ns-empty__title">No hosts yet</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-base)' }}>
              Add an SSH connection to get started.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {hosts.map((h) => (
              <div key={h.id} className="ns-settings-host-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text)' }}>
                    {h.name || `${h.username}@${h.host}`}
                  </div>
                  <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                    {h.username}@{h.host}:{h.port}
                    {h.authType === 'key' ? ' · Key' : ' · Password'}
                  </div>
                </div>
                <button className="ns-btn" data-variant="ghost" onClick={() => startEdit(h)}>
                  <Icon name="wrench" size={14} /> Edit
                </button>
                <button className="ns-btn" data-variant="ghost" style={{ color: 'var(--danger)' }} onClick={() => remove(h.id)}>
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Add / Edit form
  return (
    <Card title={editing ? 'Edit Host' : 'Add Host'} className="ns-settings-host-form">
      <FormField label="Name" hint="Optional display name">
        <input className="ns-input" value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="My Server" />
      </FormField>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
        <FormField label="Host">
          <input className="ns-input" value={form.host} onChange={(e) => update('host', e.target.value)} placeholder="192.168.1.1" />
        </FormField>
        <FormField label="Port">
          <input className="ns-input" value={form.port} onChange={(e) => update('port', e.target.value)} placeholder="22" />
        </FormField>
      </div>
      <FormField label="Username">
        <input className="ns-input" value={form.username} onChange={(e) => update('username', e.target.value)} placeholder="root" />
      </FormField>
      <FormField label="Auth Type">
        <select className="ns-input" value={form.authType} onChange={(e) => update('authType', e.target.value)}>
          <option value="password">Password</option>
          <option value="key">Private Key</option>
        </select>
      </FormField>
      {form.authType === 'password' && (
        <FormField label="Password">
          <input className="ns-input" type="password" value={form.password} onChange={(e) => update('password', e.target.value)} />
        </FormField>
      )}
      {form.authType === 'key' && (
        <FormField label="Private Key Path">
          <input className="ns-input" value={form.privateKeyPath} onChange={(e) => update('privateKeyPath', e.target.value)} placeholder="~/.ssh/id_rsa" />
        </FormField>
      )}
      <FormField label="Memo">
        <input className="ns-input" value={form.memo} onChange={(e) => update('memo', e.target.value)} placeholder="Notes about this host" />
      </FormField>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
        <button className="ns-btn" data-variant="primary" onClick={save} disabled={!form.host.trim()}>
          {editing ? 'Save Changes' : 'Add Host'}
        </button>
        <button className="ns-btn" onClick={testConn} disabled={!form.host.trim()}>
          Test Connection
        </button>
        <button className="ns-btn" data-variant="ghost" onClick={cancel}>Cancel</button>
        {testResult && (
          <span style={{
            fontSize: 'var(--fs-sm)',
            color: testResult.ok ? 'var(--success)' : 'var(--danger)',
          }}>
            {testResult.msg}
          </span>
        )}
      </div>
    </Card>
  );
}

// ——— AI Provider settings ———

function AISection(): React.ReactElement {
  const [settings, setSettings] = useState<{
    apiUrl: string; apiKeyMasked: string; model: string;
    temperature: number; maxTokens: number; systemPrompt: string;
  } | null>(null);
  const [presets, setPresets] = useState<Array<{ name: string; apiUrl: string; model: string }>>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.aiSettings) return;
    api.aiSettings.get().then(setSettings);
    api.aiSettings.getPresets().then(setPresets);
  }, []);

  const saveAI = useCallback(async () => {
    if (!settings) return;
    const api = window.electronAPI;
    await api?.aiSettings?.set({
      apiUrl: settings.apiUrl,
      apiKey: undefined, // preserve existing key unless user changes it
      model: settings.model,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      systemPrompt: settings.systemPrompt,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [settings]);

  const testAI = useCallback(async () => {
    const api = window.electronAPI;
    await api?.aiSettings?.set({
      apiUrl: settings?.apiUrl ?? '',
      apiKey: undefined,
      model: settings?.model ?? '',
      temperature: settings?.temperature ?? 0.7,
      maxTokens: settings?.maxTokens ?? 4096,
      systemPrompt: settings?.systemPrompt ?? '',
    });
    const result = await api?.aiSettings?.test();
    if (result) {
      setSaved(result.ok);
      setTimeout(() => setSaved(false), 3000);
    }
  }, [settings]);

  if (!settings) {
    return <div style={{ color: 'var(--text-muted)' }}>Loading AI settings…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {presets.length > 0 && (
        <Card title="Presets">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {presets.map((p, i) => (
              <button
                key={i}
                className="ns-btn"
                data-variant="ghost"
                onClick={() => setSettings((s) => s ? { ...s, apiUrl: p.apiUrl, model: p.model } : s)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </Card>
      )}
      <Card title="Provider Configuration">
        <FormField label="API URL">
          <input className="ns-input" value={settings.apiUrl} onChange={(e) => setSettings((s) => s ? { ...s, apiUrl: e.target.value } : s)} placeholder="https://api.openai.com/v1" />
        </FormField>
        <FormField label="API Key">
          <input className="ns-input" type="password" value={settings.apiKeyMasked} disabled style={{ opacity: 0.6 }} />
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', marginTop: 2 }}>
            Key is masked for security. To change it, type a new value below.
          </div>
        </FormField>
        <FormField label="Model">
          <input className="ns-input" value={settings.model} onChange={(e) => setSettings((s) => s ? { ...s, model: e.target.value } : s)} placeholder="gpt-4o" />
        </FormField>
        <FormField label={`Temperature: ${settings.temperature}`}>
          <input type="range" min={0} max={2} step={0.1} value={settings.temperature}
            onChange={(e) => setSettings((s) => s ? { ...s, temperature: parseFloat(e.target.value) } : s)}
            style={{ width: '100%' }} />
        </FormField>
        <FormField label="Max Tokens">
          <input className="ns-input" type="number" value={settings.maxTokens} onChange={(e) => setSettings((s) => s ? { ...s, maxTokens: parseInt(e.target.value) || 4096 } : s)} />
        </FormField>
        <FormField label="System Prompt Override">
          <textarea className="ns-input" rows={3} value={settings.systemPrompt}
            onChange={(e) => setSettings((s) => s ? { ...s, systemPrompt: e.target.value } : s)}
            placeholder="Optional system prompt for AI assistant…" />
        </FormField>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
          <button className="ns-btn" data-variant="primary" onClick={saveAI}>Save</button>
          <button className="ns-btn" onClick={testAI}>Test Connection</button>
          {saved && <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--success)' }}>Saved</span>}
        </div>
      </Card>
    </div>
  );
}

// ——— Appearance ———

function AppearanceSection(): React.ReactElement {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    window.electronAPI?.theme?.get().then(setTheme);
  }, []);

  const change = async (t: 'dark' | 'light') => {
    setTheme(t);
    await window.electronAPI?.theme?.set(t);
  };

  return (
    <Card title="Theme">
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="ns-btn" data-active={theme === 'dark'} onClick={() => change('dark')}>Dark</button>
        <button className="ns-btn" data-active={theme === 'light'} onClick={() => change('light')}>Light</button>
      </div>
    </Card>
  );
}

// ——— Shared form field ———

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-medium)', color: 'var(--text-muted)' }}>
        {label}
      </span>
      {children}
      {hint && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>{hint}</span>}
    </label>
  );
}
