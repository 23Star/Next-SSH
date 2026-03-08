/**
 * ローカルシェル（PowerShell / bash 等）を node-pty で spawn し、
 * 入出力を Renderer と IPC でやりとりする。
 * node-pty はネイティブモジュールのため未インストール時は遅延 require でエラーにし、起動は通す。
 */
import os from 'os';

type SendLocalData = (tabId: string, data: string) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const localPtyByTabId = new Map<string, { pty: any }>();

function getPty(): { spawn: (shell: string, args: string[], opts: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv }) => { write: (d: string) => void; resize: (c: number, r: number) => void; kill: () => void; onData: (cb: (d: string) => void) => void; onExit: (cb: () => void) => void } } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('node-pty');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `node-pty が見つかりません。ローカルターミナルを使うにはプロジェクトで npm install node-pty のあと npx electron-rebuild を実行してください。 (${msg})`,
    );
  }
}

function getShell(): string {
  if (os.platform() === 'win32') return 'powershell.exe';
  return process.env.SHELL || 'bash';
}

function getCwd(): string {
  try {
    return process.cwd();
  } catch {
    return os.homedir();
  }
}

export function spawnLocal(tabId: string, sendData: SendLocalData): void {
  if (localPtyByTabId.has(tabId)) return;
  const pty = getPty();
  const shell = getShell();
  const cwd = getCwd();
  const env = { ...process.env };
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd,
    env,
  });

  ptyProcess.onData((data: string) => {
    sendData(tabId, data);
  });

  ptyProcess.onExit(() => {
    localPtyByTabId.delete(tabId);
  });

  localPtyByTabId.set(tabId, { pty: ptyProcess });
}

export function writeLocal(tabId: string, data: string): boolean {
  const entry = localPtyByTabId.get(tabId);
  if (!entry) return false;
  entry.pty.write(data);
  return true;
}

export function resizeLocal(tabId: string, cols: number, rows: number): boolean {
  const entry = localPtyByTabId.get(tabId);
  if (!entry) return false;
  try {
    entry.pty.resize(cols, rows);
    return true;
  } catch {
    return false;
  }
}

export function disconnectLocal(tabId: string): void {
  const entry = localPtyByTabId.get(tabId);
  if (!entry) return;
  try {
    entry.pty.kill();
  } catch {
    // ignore
  }
  localPtyByTabId.delete(tabId);
}
