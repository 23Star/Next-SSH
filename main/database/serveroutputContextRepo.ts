import { loadServeroutputConfig } from '../config/loadServeroutputConfig';
import { getDb } from './connection';

export interface ServeroutputContextRow {
  id: number;
  envId: number;
  content: string;
  createdAt: string;
  updatedAt: string;
}

function rowToCamel(row: Record<string, unknown>): ServeroutputContextRow {
  return {
    id: row.id as number,
    envId: row.env_id as number,
    content: row.content as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function getServeroutputContextByEnvId(envId: number): ServeroutputContextRow | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM serveroutput_context WHERE env_id = ?')
    .get(envId) as Record<string, unknown> | undefined;
  return row ? rowToCamel(row) : null;
}

export function appendServeroutputContext(envId: number, data: string): void {
  const { ServeroutputContentRecordMax, ServeroutputContentTotalMax } = loadServeroutputConfig();
  const db = getDb();
  const row = db
    .prepare('SELECT id, content FROM serveroutput_context WHERE env_id = ?')
    .get(envId) as { id: number; content: string } | undefined;
  let content: string;
  if (row) {
    content = (row.content + data).slice(-ServeroutputContentRecordMax);
    db.prepare(
      'UPDATE serveroutput_context SET content = ?, updated_at = datetime(\'now\') WHERE env_id = ?',
    ).run(content, envId);
  } else {
    content = data.slice(-ServeroutputContentRecordMax);
    db.prepare(
      'INSERT INTO serveroutput_context (env_id, content) VALUES (?, ?)',
    ).run(envId, content);
  }

  let total = (db.prepare('SELECT sum(length(content)) FROM serveroutput_context').pluck().get() as number | null) ?? 0;
  while (total > ServeroutputContentTotalMax) {
    const oldest = db.prepare(
      'SELECT env_id FROM serveroutput_context WHERE length(content) > 0 ORDER BY updated_at ASC LIMIT 1',
    ).get() as { env_id: number } | undefined;
    if (!oldest) break;
    db.prepare(
      'UPDATE serveroutput_context SET content = ?, updated_at = datetime(\'now\') WHERE env_id = ?',
    ).run('', oldest.env_id);
    total = (db.prepare('SELECT sum(length(content)) FROM serveroutput_context').pluck().get() as number | null) ?? 0;
  }
}

export function getServeroutputContextByConnectionId(connectionId: number): string {
  const db = getDb();
  const row = db
    .prepare('SELECT content FROM serveroutput_by_connection WHERE connection_id = ?')
    .get(connectionId) as { content: string } | undefined;
  return row?.content ?? '';
}

export function appendServeroutputContextByConnectionId(connectionId: number, data: string): void {
  const { ServeroutputContentRecordMax } = loadServeroutputConfig();
  const db = getDb();
  const row = db
    .prepare('SELECT content FROM serveroutput_by_connection WHERE connection_id = ?')
    .get(connectionId) as { content: string } | undefined;
  const content = row
    ? (row.content + data).slice(-ServeroutputContentRecordMax)
    : data.slice(-ServeroutputContentRecordMax);
  if (row) {
    db.prepare(
      'UPDATE serveroutput_by_connection SET content = ?, updated_at = datetime(\'now\') WHERE connection_id = ?',
    ).run(content, connectionId);
  } else {
    db.prepare(
      'INSERT INTO serveroutput_by_connection (connection_id, content) VALUES (?, ?)',
    ).run(connectionId, content);
  }
}

export function setServeroutputContextContent(envId: number, content: string): void {
  const { ServeroutputContentRecordMax } = loadServeroutputConfig();
  const db = getDb();
  const trimmed = content.slice(-ServeroutputContentRecordMax);
  const row = db.prepare('SELECT id FROM serveroutput_context WHERE env_id = ?').get(envId);
  if (row) {
    db.prepare(
      'UPDATE serveroutput_context SET content = ?, updated_at = datetime(\'now\') WHERE env_id = ?',
    ).run(trimmed, envId);
  } else {
    db.prepare(
      'INSERT INTO serveroutput_context (env_id, content) VALUES (?, ?)',
    ).run(envId, trimmed);
  }
}
