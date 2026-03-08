import { getDb } from './connection';
import { decryptCredential, encryptCredential } from '../crypto/credentialCrypto';

export interface EnvironmentRow {
  id: number;
  name: string | null;
  host: string;
  port: number;
  username: string;
  authType: string;
  password: string | null;
  privateKeyPath: string | null;
  memo: string | null;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

function rowToCamel(row: Record<string, unknown>): Omit<EnvironmentRow, 'password' | 'privateKeyPath'> & { password: string | null; privateKeyPath: string | null } {
  return {
    id: row.id as number,
    name: row.name as string | null,
    host: row.host as string,
    port: row.port as number,
    username: row.username as string,
    authType: row.auth_type as string,
    password: row.password as string | null,
    privateKeyPath: row.private_key_path as string | null,
    memo: row.memo as string | null,
    isActive: row.is_active as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function decryptRow(row: ReturnType<typeof rowToCamel>): EnvironmentRow {
  return {
    ...row,
    password: decryptCredential(row.password),
    privateKeyPath: decryptCredential(row.privateKeyPath),
  };
}

export function listEnvironment(): EnvironmentRow[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM environment ORDER BY id').all() as Record<string, unknown>[];
  return rows.map((r) => decryptRow(rowToCamel(r)));
}

export function getEnvironmentById(id: number): EnvironmentRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM environment WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? decryptRow(rowToCamel(row)) : null;
}

export interface CreateEnvironmentInput {
  name?: string | null;
  host: string;
  port?: number;
  username: string;
  authType?: string;
  password?: string | null;
  privateKeyPath?: string | null;
  memo?: string | null;
}

export function createEnvironment(input: CreateEnvironmentInput): EnvironmentRow {
  const db = getDb();
  const port = input.port ?? 22;
  const authType = input.authType ?? 'password';
  const passwordStored = encryptCredential(input.password ?? null);
  const privateKeyPathStored = encryptCredential(input.privateKeyPath ?? null);
  const result = db.prepare(`
    INSERT INTO environment (name, host, port, username, auth_type, password, private_key_path, memo, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    input.name ?? null,
    input.host,
    port,
    input.username,
    authType,
    passwordStored,
    privateKeyPathStored,
    input.memo ?? null,
  );
  const row = db.prepare('SELECT * FROM environment WHERE id = ?').get(result.lastInsertRowid) as Record<string, unknown>;
  return decryptRow(rowToCamel(row));
}

export function updateEnvironment(id: number, input: Partial<CreateEnvironmentInput>): EnvironmentRow | null {
  const db = getDb();
  const current = db.prepare('SELECT * FROM environment WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!current) return null;

  const name = input.name !== undefined ? input.name : current.name;
  const host = input.host !== undefined ? input.host : current.host;
  const port = input.port !== undefined ? input.port : current.port;
  const username = input.username !== undefined ? input.username : current.username;
  const authType = input.authType !== undefined ? input.authType : current.auth_type;
  const password = input.password !== undefined ? encryptCredential(input.password) : (current.password as string | null);
  const privateKeyPath = input.privateKeyPath !== undefined ? encryptCredential(input.privateKeyPath) : (current.private_key_path as string | null);
  const memo = input.memo !== undefined ? input.memo : current.memo;

  db.prepare(`
    UPDATE environment SET name = ?, host = ?, port = ?, username = ?, auth_type = ?, password = ?, private_key_path = ?, memo = ?, updated_at = datetime('now') WHERE id = ?
  `).run(name, host, port, username, authType, password, privateKeyPath, memo, id);

  const row = db.prepare('SELECT * FROM environment WHERE id = ?').get(id) as Record<string, unknown>;
  return decryptRow(rowToCamel(row));
}

export function deleteEnvironment(id: number): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM environment WHERE id = ?').run(id);
  return result.changes > 0;
}
