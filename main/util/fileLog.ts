/**
 * 简易日志，同时输出到标准输出和项目根目录下的 log/。
 * 用于开发调试（如 ssh 的 readRemoteFile / writeRemoteFile 等）。
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
