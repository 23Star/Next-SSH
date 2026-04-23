import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';

let db: Database.Database | null = null;

function getDbPath(): string {
  const userData = app.getPath('userData');
  return path.join(userData, 'aissh.db');
}

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(getDbPath());
    runMigration();
  }
  return db;
}

function runMigration(): void {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS environment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 22,
      username TEXT NOT NULL,
      auth_type TEXT NOT NULL DEFAULT 'password',
      password TEXT,
      private_key_path TEXT,
      memo TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS chat_session (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '新聊天',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const hasChatContext = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='chat_context'",
  ).get();
  if (!hasChatContext) {
    const hasChatMessage = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='chat_message'",
    ).get();
    if (hasChatMessage) {
      db.exec('ALTER TABLE chat_message RENAME TO chat_context');
    } else {
      db.exec(`
        CREATE TABLE chat_context (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER NOT NULL REFERENCES chat_session(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          suggested_commands TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    }
  }
  // thinking columns for chat_context (idempotent)
  const hasThinking = db.prepare("SELECT 1 FROM pragma_table_info('chat_context') WHERE name='thinking'").get();
  if (!hasThinking) {
    db.exec('ALTER TABLE chat_context ADD COLUMN thinking TEXT');
  }
  const hasDuration = db.prepare("SELECT 1 FROM pragma_table_info('chat_context') WHERE name='thinking_duration_ms'").get();
  if (!hasDuration) {
    db.exec('ALTER TABLE chat_context ADD COLUMN thinking_duration_ms INTEGER');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS serveroutput_context (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      env_id INTEGER NOT NULL UNIQUE REFERENCES environment(id) ON DELETE CASCADE,
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS serveroutput_by_connection (
      connection_id INTEGER PRIMARY KEY,
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
