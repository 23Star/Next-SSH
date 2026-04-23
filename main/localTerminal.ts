/**
 * 使用 node-pty 启动本地 Shell（PowerShell / bash 等），
 * 通过 IPC 与渲染进程进行输入输出交互。
 * node-pty 是原生模块，未安装时通过延迟 require 报错，但不阻止启动。
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
      `未找到 node-pty。要使用本地终端，请在项目中执行 npm install node-pty，然后运行 npx electron-rebuild。(${msg})`,
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
