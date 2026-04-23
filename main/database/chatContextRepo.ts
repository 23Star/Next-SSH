import { loadChatConfig } from '../config/loadChatConfig';
import { getDb } from './connection';

/** 指定会话的总字符数 */
function getTotalContentLengthBySessionId(sessionId: number): number {
  const db = getDb();
  const total = db
    .prepare('SELECT sum(length(content)) FROM chat_context WHERE session_id = ?')
    .pluck()
    .get(sessionId) as number | null;
  return total ?? 0;
}

/** 删除指定会话中最旧的消息（id 最小）1 条 */
function deleteOldestChatContextInSession(sessionId: number): void {
  const db = getDb();
  const row = db
    .prepare('SELECT id FROM chat_context WHERE session_id = ? ORDER BY id ASC LIMIT 1')
    .get(sessionId) as { id: number } | undefined;
  if (row) db.prepare('DELETE FROM chat_context WHERE id = ?').run(row.id);
}

/**
 * 当会话总字符数超过上限时，从最旧的消息开始依次删除，使其保持在限制范围内。
 */
export function trimChatContextToTotalMax(sessionId: number): void {
  const { ChatContextTotalMax } = loadChatConfig();
  let total = getTotalContentLengthBySessionId(sessionId);
  while (total > ChatContextTotalMax) {
    deleteOldestChatContextInSession(sessionId);
    total = getTotalContentLengthBySessionId(sessionId);
  }
}

export interface ChatContextRow {
  id: number;
  sessionId: number;
  role: string;
  content: string;
  thinking: string | null;
  thinkingDurationMs: number | null;
  suggestedCommands: string[] | null;
  createdAt: string;
}

function rowToCamel(row: Record<string, unknown>): ChatContextRow {
  let suggestedCommands: string[] | null = null;
  if (row.suggested_commands != null && typeof row.suggested_commands === 'string') {
    try {
      const parsed = JSON.parse(row.suggested_commands) as unknown;
      suggestedCommands = Array.isArray(parsed) ? parsed : null;
    } catch {
      suggestedCommands = null;
    }
  }
  return {
    id: row.id as number,
    sessionId: row.session_id as number,
    role: row.role as string,
    content: row.content as string,
    thinking: (row.thinking as string) ?? null,
    thinkingDurationMs: (row.thinking_duration_ms as number) ?? null,
    suggestedCommands,
    createdAt: row.created_at as string,
  };
}

export function listChatContextBySessionId(sessionId: number): ChatContextRow[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM chat_context WHERE session_id = ? ORDER BY id')
    .all(sessionId) as Record<string, unknown>[];
  return rows.map(rowToCamel);
}

export function addChatContext(
  sessionId: number,
  role: string,
  content: string,
  suggestedCommands?: string[] | null,
  thinking?: string | null,
  thinkingDurationMs?: number | null,
): ChatContextRow {
  const db = getDb();
  const suggestedJson = suggestedCommands != null ? JSON.stringify(suggestedCommands) : null;
  const result = db
    .prepare(
      'INSERT INTO chat_context (session_id, role, content, suggested_commands, thinking, thinking_duration_ms) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(sessionId, role, content, suggestedJson, thinking ?? null, thinkingDurationMs ?? null);
  db.prepare('UPDATE chat_session SET updated_at = datetime(\'now\') WHERE id = ?').run(sessionId);
  trimChatContextToTotalMax(sessionId);
  const row = db.prepare('SELECT * FROM chat_context WHERE id = ?').get(result.lastInsertRowid) as Record<string, unknown>;
  return rowToCamel(row);
}

export function deleteChatContextByIds(ids: number[]): void {
  if (ids.length === 0) return;
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM chat_context WHERE id IN (${placeholders})`).run(...ids);
}
