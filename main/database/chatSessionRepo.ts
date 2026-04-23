import { getDb } from './connection';

export interface ChatSessionRow {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}

function rowToCamel(row: Record<string, unknown>): ChatSessionRow {
  return {
    id: row.id as number,
    title: row.title as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function listChatSessions(): ChatSessionRow[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM chat_session ORDER BY id').all() as Record<string, unknown>[];
  return rows.map(rowToCamel);
}

export function getChatSessionById(id: number): ChatSessionRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM chat_session WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToCamel(row) : null;
}

export function createChatSession(title?: string | null): ChatSessionRow {
  const db = getDb();
  const t = title?.trim() || '新聊天';
  const result = db.prepare('INSERT INTO chat_session (title) VALUES (?)').run(t);
  const row = db.prepare('SELECT * FROM chat_session WHERE id = ?').get(result.lastInsertRowid) as Record<string, unknown>;
  return rowToCamel(row);
}

export function updateChatSession(id: number, input: { title?: string }): ChatSessionRow | null {
  const db = getDb();
  const current = db.prepare('SELECT * FROM chat_session WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!current) return null;
  const title = input.title !== undefined ? input.title.trim() || '新聊天' : (current.title as string);
  db.prepare('UPDATE chat_session SET title = ?, updated_at = datetime(\'now\') WHERE id = ?').run(title, id);
  const row = db.prepare('SELECT * FROM chat_session WHERE id = ?').get(id) as Record<string, unknown>;
  return rowToCamel(row);
}

export function deleteChatSession(id: number): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM chat_session WHERE id = ?').run(id);
  return result.changes > 0;
}
