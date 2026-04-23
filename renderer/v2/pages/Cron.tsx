// Cron page — crontab editor with schedule preview.
//
// Reads the current user's crontab via `crontab -l`, provides a raw editor
// and a parsed task view. Write-back via `echo 'content' | crontab -`.

import React, { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { getTerminal } from '../lib/electron';
import { getCachedCron, CACHE_KEYS } from '../lib/usePreload';
import { writeCache } from '../lib/cache';

interface CronProps {
  connectionId: number | null;
  connStatus: string;
  refreshTick: number;
}

interface CronEntry {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
  command: string;
  raw: string;
  isComment: boolean;
}

const DAY_NAMES: Record<string, string> = {
  '0': '日', '1': '一', '2': '二', '3': '三',
  '4': '四', '5': '五', '6': '六', '7': '日',
};

function describeSchedule(e: CronEntry): string {
  if (e.isComment) return '注释';
  const { minute, hour, dayOfMonth, month, dayOfWeek } = e;
  const parts: string[] = [];

  // Time
  if (minute === '*' && hour === '*') {
    parts.push('每分钟');
  } else if (hour === '*') {
    parts.push(`每小时第 ${minute} 分钟`);
  } else if (minute === '*') {
    parts.push(`${hour} 点每分钟`);
  } else {
    parts.push(`At ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`);
  }

  // Day of month
  if (dayOfMonth !== '*') parts.push(`每月 ${dayOfMonth} 日`);

  // Month
  if (month !== '*') parts.push(`${month} 月`);

  // Day of week
  if (dayOfWeek !== '*') {
    const name = DAY_NAMES[dayOfWeek] || dayOfWeek;
    parts.push(`每周${name}`);
  }

  return parts.join(', ');
}

function parseCrontab(text: string): CronEntry[] {
  return text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return {
        minute: '', hour: '', dayOfMonth: '', month: '', dayOfWeek: '',
        command: '', raw: line, isComment: true,
      };
    }
    const parts = trimmed.split(/\s+/);
    if (parts.length < 6) {
      return {
        minute: '', hour: '', dayOfMonth: '', month: '', dayOfWeek: '',
        command: '', raw: line, isComment: true,
      };
    }
    return {
      minute: parts[0],
      hour: parts[1],
      dayOfMonth: parts[2],
      month: parts[3],
      dayOfWeek: parts[4],
      command: parts.slice(5).join(' '),
      raw: line,
      isComment: false,
    };
  });
}

export function Cron({ connectionId, connStatus, refreshTick }: CronProps): React.ReactElement {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [rawContent, setRawContent] = useState('');
  const [editorContent, setEditorContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  const canUse = connectionId != null && connStatus === 'connected';

  const load = useCallback(async () => {
    if (!canUse || connectionId == null) return;
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const term = getTerminal();
      const res = await term.exec(
        connectionId,
        'crontab -l 2>/dev/null || true',
        15000,
      );
      const content = (res.stdout || '').trimEnd();
      writeCache(CACHE_KEYS.cron, content);
      setRawContent(content);
      setEditorContent(content);
      setIsDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [canUse, connectionId]);

  useEffect(() => {
    // Seed from cache first
    const cached = getCachedCron();
    if (cached !== undefined && cached !== '') {
      setRawContent(cached);
      setEditorContent(cached);
    }
    void load();
  }, [load, refreshTick]);

  const save = async (): Promise<void> => {
    if (connectionId == null) return;
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const term = getTerminal();
      // Escape single quotes in content
      const escaped = editorContent.replace(/'/g, "'\\''");
      const res = await term.exec(
        connectionId,
        `echo '${escaped}' | crontab -`,
        15000,
      );
      if (res.exitCode !== 0 && res.exitCode !== null) {
        throw new Error(res.stderr || `Exit code ${res.exitCode}`);
      }
      setRawContent(editorContent);
      setIsDirty(false);
      setSuccessMsg('Crontab 保存成功');
      // Reload to verify
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const entries = parseCrontab(editorContent);
  const activeEntries = entries.filter((e) => !e.isComment);

  if (!canUse) {
    return (
      <div className="ns-page">
        <div className="ns-page__header">
          <div>
            <h1 className="ns-page__title">计划任务</h1>
            <div className="ns-page__subtitle">Crontab 编辑器</div>
          </div>
        </div>
        <EmptyState
          icon="cron"
          title="请选择并连接一台主机"
          description="查看和编辑远程服务器上的 crontab 计划任务"
        />
      </div>
    );
  }

  return (
    <div className="ns-page">
      <div className="ns-page__header">
        <div>
          <h1 className="ns-page__title">计划任务</h1>
          <div className="ns-page__subtitle">
            {activeEntries.length} 个活跃任务
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'center' }}>
          <button className="ns-btn" onClick={() => void load()} disabled={loading}>
            <Icon name="refresh" size={14} /> 重新加载
          </button>
          <button
            className="ns-btn"
            data-variant="primary"
            onClick={() => void save()}
            disabled={saving || !isDirty}
          >
            <Icon name="save" size={14} /> {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {error && (
        <div className="ns-msg ns-msg--system" data-tone="error">
          <span>{error}</span>
        </div>
      )}
      {successMsg && (
        <div className="ns-msg ns-msg--system" data-tone="ok">
          <span>{successMsg}</span>
        </div>
      )}

      <div className="ns-cron-grid">
        {/* Raw editor */}
        <section className="ns-card" data-col="5" style={{ display: 'flex', flexDirection: 'column' }}>
          <h3 className="ns-card__title">Crontab 编辑器</h3>
          <textarea
            className="ns-cron-editor"
            value={editorContent}
            onChange={(e) => {
              setEditorContent(e.target.value);
              setIsDirty(true);
              setSuccessMsg(null);
            }}
            spellCheck={false}
            placeholder="无 crontab 条目，在此添加任务..."
          />
          {isDirty && (
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--warn)', marginTop: 'var(--s-2)' }}>
              未保存的更改
            </div>
          )}
        </section>

        {/* Parsed task list */}
        <section className="ns-card" data-col="7" style={{ display: 'flex', flexDirection: 'column' }}>
          <h3 className="ns-card__title">已解析任务</h3>
          {activeEntries.length === 0 ? (
            <div className="ns-card__caption" style={{ padding: 'var(--s-4)', textAlign: 'center' }}>
              未找到活跃的计划任务
            </div>
          ) : (
            <table className="ns-table">
              <thead>
                <tr>
                  <th>调度表达式</th>
                  <th>说明</th>
                  <th>命令</th>
                </tr>
              </thead>
              <tbody>
                {activeEntries.map((entry, idx) => (
                  <tr key={idx}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}>
                      {entry.minute} {entry.hour} {entry.dayOfMonth} {entry.month} {entry.dayOfWeek}
                    </td>
                    <td style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {describeSchedule(entry)}
                    </td>
                    <td
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--fs-sm)',
                        maxWidth: 300,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={entry.command}
                    >
                      {entry.command}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Quick reference */}
          <div style={{ marginTop: 'auto', paddingTop: 'var(--s-3)', borderTop: '1px solid var(--border)' }}>
            <h4 className="ns-card__title" style={{ marginBottom: 'var(--s-2)' }}>快速参考</h4>
            <pre className="ns-tool__pre" style={{ fontSize: 'var(--fs-xs)', maxHeight: 120 }}>
{`# ┌──────── 分钟 (0-59)
# │ ┌────── 小时 (0-23)
# │ │ ┌──── 每月天数 (1-31)
# │ │ │ ┌── 月份 (1-12)
# │ │ │ │ ┌ 每周几 (0-7, 0=周日)
# * * * * * 命令
# 示例：
# */5 * * * *     每 5 分钟
# 0 2 * * *       每天凌晨 2:00
# 0 0 * * 1       每周一零点`}
            </pre>
          </div>
        </section>
      </div>
    </div>
  );
}
