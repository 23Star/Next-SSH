/**
 * 標準出力 + プロジェクト直下 log/ に同じ内容を出す簡易ログ。
 * 開発時のデバッグ用（ssh の readRemoteFile / writeRemoteFile など）。
 */
import fs from 'fs';
import path from 'path';

const LOG_DIR = path.join(process.cwd(), 'log');
const LOG_FILE = path.join(LOG_DIR, 'ssh-file.log');

function ensureLogDir(): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

export function log(tag: string, message: string, detail?: unknown): void {
  const line = `[${new Date().toISOString()}] [${tag}] ${message}` + (detail !== undefined ? ` ${JSON.stringify(detail)}` : '');
  console.log(line);
  try {
    ensureLogDir();
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch {
    // ignore
  }
}
