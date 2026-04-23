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
          <h1 className="ns-page__title">设置</h1>
          <div className="ns-page__subtitle">管理连接、AI 提供商和外观</div>
        </div>
      </div>

      <div className="ns-settings-tabs">
        <button className="ns-tab" data-active={tab === 'hosts'} onClick={() => setTab('hosts')}>
          <span className="ns-tab__icon"><Icon name="plug" size={16} /></span>
          <span>SSH 主机</span>
        </button>
        <button className="ns-tab" data-active={tab === 'ai'} onClick={() => setTab('ai')}>
          <span className="ns-tab__icon"><Icon name="sparkle" size={16} /></span>
          <span>AI 提供商</span>
        </button>
        <button className="ns-tab" data-active={tab === 'appearance'} onClick={() => setTab('appearance')}>
          <span className="ns-tab__icon"><Icon name="settings" size={16} /></span>
          <span>外观</span>
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
    if (!confirm('确定删除此主机？')) return;
    const api = getApi();
    await api.environment.delete(id);
    await refresh();
  }, [refresh]);

  const testConn = useCallback(async () => {
    const api = getApi();
    const ok = await api.environment.testConnection(form.host.trim(), Number(form.port) || 22);
    setTestResult({ ok, msg: ok ? '连接成功' : '连接失败' });
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
            已保存主机 ({hosts.length})
          </span>
          <button className="ns-btn" data-variant="primary" onClick={startAdd}>
            <Icon name="send" size={14} /> 添加主机
          </button>
        </div>

        {hosts.length === 0 ? (
          <div className="ns-empty" style={{ padding: 'var(--s-10)' }}>
            <div className="ns-empty__icon"><Icon name="plug" size={20} /></div>
            <p className="ns-empty__title">暂无主机</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-base)' }}>
              添加一个 SSH 连接以开始使用
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
                    {h.authType === 'key' ? ' · 密钥' : ' · 密码'}
                  </div>
                </div>
                <button className="ns-btn" data-variant="ghost" onClick={() => startEdit(h)}>
                  <Icon name="wrench" size={14} /> 编辑
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
    <Card title={editing ? '编辑主机' : '添加主机'} className="ns-settings-host-form">
      <FormField label="名称" hint="可选的显示名称">
        <input className="ns-input" value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="My Server" />
      </FormField>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
        <FormField label="主机地址">
          <input className="ns-input" value={form.host} onChange={(e) => update('host', e.target.value)} placeholder="192.168.1.1" />
        </FormField>
        <FormField label="端口">
          <input className="ns-input" value={form.port} onChange={(e) => update('port', e.target.value)} placeholder="22" />
        </FormField>
      </div>
      <FormField label="用户名">
        <input className="ns-input" value={form.username} onChange={(e) => update('username', e.target.value)} placeholder="root" />
      </FormField>
      <FormField label="认证方式">
        <select className="ns-input" value={form.authType} onChange={(e) => update('authType', e.target.value)}>
          <option value="password">密码</option>
          <option value="key">私钥</option>
        </select>
      </FormField>
      {form.authType === 'password' && (
        <FormField label="密码">
          <input className="ns-input" type="password" value={form.password} onChange={(e) => update('password', e.target.value)} />
        </FormField>
      )}
      {form.authType === 'key' && (
        <FormField label="私钥路径">
          <input className="ns-input" value={form.privateKeyPath} onChange={(e) => update('privateKeyPath', e.target.value)} placeholder="~/.ssh/id_rsa" />
        </FormField>
      )}
      <FormField label="备注">
        <input className="ns-input" value={form.memo} onChange={(e) => update('memo', e.target.value)} placeholder="Notes about this host" />
      </FormField>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
        <button className="ns-btn" data-variant="primary" onClick={save} disabled={!form.host.trim()}>
          {editing ? '保存修改' : '添加主机'}
        </button>
        <button className="ns-btn" onClick={testConn} disabled={!form.host.trim()}>
          测试连接
        </button>
        <button className="ns-btn" data-variant="ghost" onClick={cancel}>取消</button>
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
    return <div style={{ color: 'var(--text-muted)' }}>正在加载 AI 设置…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {presets.length > 0 && (
        <Card title="预设">
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
      <Card title="提供商配置">
        <FormField label="API 地址">
          <input className="ns-input" value={settings.apiUrl} onChange={(e) => setSettings((s) => s ? { ...s, apiUrl: e.target.value } : s)} placeholder="https://api.openai.com/v1" />
        </FormField>
        <FormField label="API 密钥">
          <input className="ns-input" type="password" value={settings.apiKeyMasked} disabled style={{ opacity: 0.6 }} />
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', marginTop: 2 }}>
            密钥已脱敏显示，如需更换请在下方输入新值
          </div>
        </FormField>
        <FormField label="模型">
          <input className="ns-input" value={settings.model} onChange={(e) => setSettings((s) => s ? { ...s, model: e.target.value } : s)} placeholder="gpt-4o" />
        </FormField>
        <FormField label={`温度: ${settings.temperature}`}>
          <input type="range" min={0} max={2} step={0.1} value={settings.temperature}
            onChange={(e) => setSettings((s) => s ? { ...s, temperature: parseFloat(e.target.value) } : s)}
            style={{ width: '100%' }} />
        </FormField>
        <FormField label="最大 Token 数">
          <input className="ns-input" type="number" value={settings.maxTokens} onChange={(e) => setSettings((s) => s ? { ...s, maxTokens: parseInt(e.target.value) || 4096 } : s)} />
        </FormField>
        <FormField label="系统提示词覆盖">
          <textarea className="ns-input" rows={3} value={settings.systemPrompt}
            onChange={(e) => setSettings((s) => s ? { ...s, systemPrompt: e.target.value } : s)}
            placeholder="自定义 AI 助手的系统提示词…" />
        </FormField>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
          <button className="ns-btn" data-variant="primary" onClick={saveAI}>保存</button>
          <button className="ns-btn" onClick={testAI}>测试连接</button>
          {saved && <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--success)' }}>已保存</span>}
        </div>
      </Card>
    </div>
  );
}

// ——— Appearance ———

type Locale = 'en' | 'zn' | 'ru';

const LOCALE_OPTIONS: { value: Locale; label: string }[] = [
  { value: 'zn', label: '简体中文' },
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
];

function AppearanceSection(): React.ReactElement {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [locale, setLocale] = useState<Locale>('zn');

  useEffect(() => {
    window.electronAPI?.theme?.get().then(setTheme);
    window.electronAPI?.locale?.get().then((l) => setLocale(l ?? 'zn'));
  }, []);

  const changeTheme = async (t: 'dark' | 'light') => {
    setTheme(t);
    await window.electronAPI?.theme?.set(t);
  };

  const changeLocale = async (l: Locale) => {
    setLocale(l);
    await window.electronAPI?.locale?.set(l);
  };

  return (
    <>
      <Card title="主题">
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="ns-btn" data-active={theme === 'dark'} onClick={() => changeTheme('dark')}>深色</button>
          <button className="ns-btn" data-active={theme === 'light'} onClick={() => changeTheme('light')}>浅色</button>
        </div>
      </Card>
      <div style={{ marginTop: 12 }}>
        <Card title="语言 / Language">
          <select
            className="ns-input"
            value={locale}
            onChange={(e) => changeLocale(e.target.value as Locale)}
            style={{ width: 200 }}
          >
            {LOCALE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', marginTop: 4 }}>
            部分页面需要重启后生效
          </div>
        </Card>
      </div>
    </>
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
