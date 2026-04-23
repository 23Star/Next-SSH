import { Client } from 'ssh2';
import fs from 'fs';
import path from 'path';
import type { EnvironmentRow } from '../database/environmentRepo';
import type { SFTPWrapper } from 'ssh2';
import { log as fileLog } from '../util/fileLog';

export type DataCallback = (connectionId: number, data: string) => void;

type ShellStream = NodeJS.ReadWriteStream & {
  write: (d: string) => void;
  end: () => void;
  setWindow?: (rows: number, cols: number, height: number, width: number) => void;
};
const connections = new Map<number, { client: Client; stream: ShellStream }>();

// Concurrency limiter for SSH exec channels.
// OpenSSH servers default to MaxSessions=10; keep well below that to
// avoid "Channel open failure: open failed" (SSH_OPEN_RESOURCE_SHORTAGE).
const MAX_CONCURRENT_EXEC = 5;
let activeExecCount = 0;
const execQueue: Array<() => void> = [];

function acquireExecSlot(): Promise<void> {
  if (activeExecCount < MAX_CONCURRENT_EXEC) {
    activeExecCount++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    execQueue.push(resolve);
  });
}

function releaseExecSlot(): void {
  activeExecCount--;
  if (execQueue.length > 0 && activeExecCount < MAX_CONCURRENT_EXEC) {
    activeExecCount++;
    const next = execQueue.shift();
    if (next) next();
  }
}

/**
 * Run a function that opens an SSH exec channel, guarded by the semaphore.
 * ALL c.client.exec() calls must go through this to avoid exceeding MaxSessions.
 */
async function withExecChannel<T>(fn: () => Promise<T>): Promise<T> {
  await acquireExecSlot();
  try {
    return await fn();
  } finally {
    releaseExecSlot();
  }
}

export function connect(
  connectionId: number,
  env: EnvironmentRow,
  passphrase: string | null,
  onData: DataCallback,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (connections.has(connectionId)) {
      reject(new Error('Already connected'));
      return;
    }

    const config: Record<string, unknown> = {
      host: env.host,
      port: env.port,
      username: env.username,
    };

    if (env.authType === 'password') {
      config.password = env.password ?? '';
    } else {
      if (!env.privateKeyPath) {
        reject(new Error('Private key path is required'));
        return;
      }
      try {
        config.privateKey = fs.readFileSync(env.privateKeyPath, 'utf8');
        if (passphrase) config.passphrase = passphrase;
      } catch (e) {
        reject(e);
        return;
      }
    }

    const client = new Client();
    client.on('error', (err: Error) => {
      connections.delete(connectionId);
      onData(connectionId, `\r\n[SSH Error] ${err.message}\r\n`);
    });

    client.on('ready', () => {
      const ptyOpts = {
        term: 'xterm-256color',
        rows: 40,
        cols: 120,
        height: 480,
        width: 640,
      };
      client.shell(ptyOpts, (errShell: Error | undefined, stream: NodeJS.ReadWriteStream | undefined) => {
        if (errShell || !stream) {
          client.end();
          connections.delete(connectionId);
          reject(errShell || new Error('No stream'));
          return;
        }
        const ch = stream as ShellStream & { stderr: { on: (e: string, cb: (chunk: Buffer) => void) => void } };
        ch.on('data', (chunk: Buffer) => {
          onData(connectionId, chunk.toString());
        });
        if (ch.stderr) ch.stderr.on('data', (chunk: Buffer) => onData(connectionId, chunk.toString()));
        ch.on('close', () => {
          connections.delete(connectionId);
          client.end();
        });
        connections.set(connectionId, { client, stream });
        resolve();
      });
    });

    client.connect(config as import('ssh2').ConnectConfig).on('error', (err: Error) => {
      connections.delete(connectionId);
      reject(err);
    });
  });
}

export function disconnect(connectionId: number): void {
  const c = connections.get(connectionId);
  if (c) {
    c.stream.end();
    connections.delete(connectionId);
  }
}

export function write(connectionId: number, data: string): boolean {
  const c = connections.get(connectionId);
  if (!c) return false;
  c.stream.write(data);
  return true;
}

/** 通知服务器 PTY 窗口大小（用于 vim 等正确显示行高） */
export function resize(connectionId: number, rows: number, cols: number, height?: number, width?: number): boolean {
  const c = connections.get(connectionId);
  if (!c?.stream.setWindow) return false;
  const h = typeof height === 'number' && height > 0 ? height : 480;
  const w = typeof width === 'number' && width > 0 ? width : 640;
  c.stream.setWindow(rows, cols, h, w);
  return true;
}

/** 连接中执行 echo $HOME 获取主目录路径。 */
export function getHome(connectionId: number): Promise<string> {
  const c = connections.get(connectionId);
  if (!c) return Promise.reject(new Error('Not connected'));
  return withExecChannel(() => new Promise((resolve, reject) => {
    c.client.exec('echo $HOME', (err: Error | undefined, stream: NodeJS.ReadableStream | undefined) => {
      if (err) return reject(err);
      if (!stream) return reject(new Error('No exec stream'));
      let out = '';
      stream.on('data', (chunk: Buffer) => {
        out += chunk.toString();
      });
      const stderr = (stream as { stderr?: NodeJS.ReadableStream }).stderr;
      if (stderr) stderr.on('data', () => {});
      stream.on('close', () => {
        const result = out.trim();
        console.log('[ssh] getHome result:', JSON.stringify(result));
        resolve(result);
      });
    });
  }));
}

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  size?: string;
  mtime?: string;
  permissions?: string;
}

/** 使用 ls -l 获取指定路径的目录列表（无需 SFTP）。 */
export function listDirectory(connectionId: number, dirPath: string): Promise<DirEntry[]> {
  const c = connections.get(connectionId);
  if (!c) return Promise.reject(new Error('Not connected'));
  const safePath = dirPath.replace(/'/g, "'\\''");
  const cmd = `ls -lA --time-style=long-iso --group-directories-first '${safePath}' 2>/dev/null || ls -lA '${safePath}'`;
  return withExecChannel(() => new Promise((resolve, reject) => {
    c.client.exec(cmd, (err: Error | undefined, stream: NodeJS.ReadableStream | undefined) => {
      if (err) return reject(err);
      if (!stream) return reject(new Error('No exec stream'));
      let out = '';
      stream.on('data', (chunk: Buffer) => { out += chunk.toString(); });
      const stderr = (stream as { stderr?: NodeJS.ReadableStream }).stderr;
      if (stderr) stderr.on('data', () => {});
      stream.on('close', () => {
        const lines = out.split(/\r?\n/).filter((l) => l.trim().length > 0 && l !== '.' && l !== '..' && !l.startsWith('total'));
        const result: DirEntry[] = [];
        for (const line of lines) {
          // ls -l format: perms links owner group size YYYY-MM-DD HH:MM name
          // e.g.: drwxr-xr-x  2 root root 4096 2024-01-15 10:30 dirname
          // e.g.: -rw-r--r--  1 root root  256 2024-01-15 10:30 file.txt
          const match = line.match(/^([dlcbps-][-rwxsStT]{9})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(.+)$/);
          if (match) {
            const perms = match[1];
            const sizeNum = parseInt(match[2], 10);
            const mtime = match[3];
            const name = match[4];
            if (name === '.' || name === '..') continue;
            const isDir = perms[0] === 'd';
            result.push({
              name,
              isDirectory: isDir,
              size: isDir ? '' : formatSize(sizeNum),
              mtime,
              permissions: perms,
            });
          } else if (line.length > 0) {
            // Fallback for non-standard ls output (e.g. symlinks with ->)
            const parts = line.split(/\s+/);
            const nameIdx = parts.findIndex((_, i) => i > 5 && /^\d{4}-\d{2}-\d{2}$/.test(parts[i]));
            if (nameIdx >= 0 && nameIdx + 2 < parts.length) {
              const name = parts.slice(nameIdx + 2).join(' ');
              if (name === '.' || name === '..') continue;
              result.push({ name, isDirectory: parts[0][0] === 'd' });
            }
          }
        }
        // Ensure directories first, then alphabetical
        result.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
        resolve(result);
      });
    });
  }));
}
export function getFileSize(connectionId: number, remotePath: string): Promise<number> {
  const c = connections.get(connectionId);
  if (!c) return Promise.reject(new Error('Not connected'));
  const safePath = remotePath.replace(/'/g, "'\\''");
  return withExecChannel(() => new Promise((resolve, reject) => {
    c.client.exec(`stat -c '%s' '${safePath}' 2>/dev/null || wc -c < '${safePath}'`, (err: Error | undefined, stream: NodeJS.ReadableStream | undefined) => {
      if (err) return reject(err);
      if (!stream) return reject(new Error('No exec stream'));
      let out = '';
      stream.on('data', (chunk: Buffer) => { out += chunk.toString(); });
      stream.on('close', () => {
        const size = parseInt(out.trim(), 10);
        resolve(isNaN(size) ? 0 : size);
      });
    });
  }));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

function isDirMode(mode: number): boolean {
  return (mode & 0o170000) === 0o040000;
}

/** 从远程下载文件/文件夹到本地。sftp 由调用方保持打开。 */
function downloadOne(
  sftp: SFTPWrapper,
  remotePath: string,
  localDir: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (err, stats) => {
      if (err) return reject(err);
      const name = path.basename(remotePath);
      const localPath = path.join(localDir, name);
      if (isDirMode(stats.mode)) {
        fs.mkdirSync(localPath, { recursive: true });
        sftp.readdir(remotePath, (errRead, list) => {
          if (errRead) return reject(errRead);
          const entries = (list || []).filter((e) => e.filename !== '.' && e.filename !== '..');
          const next = remotePath.endsWith('/') ? remotePath : remotePath + '/';
          (async () => {
            for (const e of entries) {
              await downloadOne(sftp, next + e.filename, localPath);
            }
          })().then(resolve, reject);
        });
      } else {
        sftp.fastGet(remotePath, localPath, (e) => (e ? reject(e) : resolve()));
      }
    });
  });
}

/** 从远程下载指定路径到本地文件夹（支持递归）。 */
export function downloadToLocal(
  connectionId: number,
  remotePaths: string[],
  localDir: string,
): Promise<void> {
  const c = connections.get(connectionId);
  if (!c) return Promise.reject(new Error('Not connected'));
  return new Promise((resolve, reject) => {
    c.client.sftp((err: Error | undefined, sftp: SFTPWrapper | undefined) => {
      if (err) return reject(err);
      if (!sftp) return reject(new Error('No SFTP'));
      (async () => {
        try {
          for (const remotePath of remotePaths) {
            await downloadOne(sftp, remotePath, localDir);
          }
        } finally {
          sftp.end();
        }
      })().then(resolve, reject);
    });
  });
}

/** 上传本地文件/文件夹到远程。remoteDir 不带末尾 /。 */
function uploadOne(
  sftp: SFTPWrapper,
  localPath: string,
  remoteDir: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const stat = fs.statSync(localPath);
    const name = path.basename(localPath);
    const remotePath = remoteDir.endsWith('/') ? remoteDir + name : remoteDir + '/' + name;
    if (stat.isDirectory()) {
      sftp.mkdir(remotePath, (errMk) => {
        if (errMk && (errMk as { code?: number }).code !== 4) return reject(errMk); // 4 = already exists
        const entries = fs.readdirSync(localPath, { withFileTypes: true })
          .filter((e) => e.name !== '.' && e.name !== '..');
        if (entries.length === 0) return resolve();
        (async () => {
          for (const e of entries) {
            await uploadOne(sftp, path.join(localPath, e.name), remotePath);
          }
        })().then(resolve, reject);
      });
    } else {
      sftp.fastPut(localPath, remotePath, (e) => (e ? reject(e) : resolve()));
    }
  });
}

/** 上传本地路径到指定远程文件夹（支持递归）。 */
export function uploadToRemote(
  connectionId: number,
  localPaths: string[],
  remoteDir: string,
): Promise<void> {
  const c = connections.get(connectionId);
  if (!c) return Promise.reject(new Error('Not connected'));
  const normalizedRemote = remoteDir.replace(/\\/g, '/').replace(/\/+$/, '');
  return new Promise((resolve, reject) => {
    c.client.sftp((err: Error | undefined, sftp: SFTPWrapper | undefined) => {
      if (err) return reject(err);
      if (!sftp) return reject(new Error('No SFTP'));
      (async () => {
        try {
          for (const localPath of localPaths) {
            const resolved = path.resolve(localPath);
            if (!fs.existsSync(resolved)) continue;
            await uploadOne(sftp, resolved, normalizedRemote);
          }
        } finally {
          sftp.end();
        }
      })().then(resolve, reject);
    });
  });
}

/** Shell 路径转义（单引号包裹，内部的 ' 转为 '\''）。 */
function escapePathForShell(remotePath: string): string {
  return "'" + remotePath.replace(/'/g, "'\\''") + "'";
}

/** 读取远程文本文件（UTF-8）。编辑器使用。 */
export function readRemoteFile(connectionId: number, remotePath: string): Promise<string> {
  fileLog('readRemoteFile', 'start', { connectionId, remotePath });
  const c = connections.get(connectionId);
  if (!c) {
    fileLog('readRemoteFile', 'reject: not connected', { connectionId });
    return Promise.reject(new Error('Not connected'));
  }
  return withExecChannel(() => new Promise((resolve, reject) => {
    const cmd = `cat -- ${escapePathForShell(remotePath)}`;
    c.client.exec(cmd, (err: Error | undefined, stream: NodeJS.ReadableStream | undefined) => {
      if (err) {
        fileLog('readRemoteFile', 'exec err', { message: err.message });
        return reject(err);
      }
      if (!stream) {
        fileLog('readRemoteFile', 'reject: no stream');
        return reject(new Error('No exec stream'));
      }
      let out = '';
      stream.on('data', (chunk: Buffer) => {
        out += chunk.toString();
      });
      const stderr = (stream as { stderr?: NodeJS.ReadableStream }).stderr;
      if (stderr) stderr.on('data', () => {});
      stream.on('close', (code: number) => {
        fileLog('readRemoteFile', 'close', { code, outLen: out.length });
        if (code !== 0) return reject(new Error(`exit ${code}`));
        resolve(out);
      });
      stream.on('error', (e: Error) => {
        fileLog('readRemoteFile', 'stream error', { message: e.message });
        reject(e);
      });
    });
  }));
}

/** 写入远程文本文件（UTF-8）。编辑器保存使用。 */
export function writeRemoteFile(connectionId: number, remotePath: string, content: string): Promise<void> {
  fileLog('writeRemoteFile', 'start', { connectionId, remotePath, contentLen: content.length });
  const c = connections.get(connectionId);
  if (!c) {
    fileLog('writeRemoteFile', 'reject: not connected', { connectionId });
    return Promise.reject(new Error('Not connected'));
  }
  return withExecChannel(() => new Promise((resolve, reject) => {
    const cmd = `cat > ${escapePathForShell(remotePath)}`;
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const timeoutMs = 30000;
    const t = setTimeout(() => {
      settle(() => {
        fileLog('writeRemoteFile', 'timeout', { timeoutMs });
        reject(new Error('writeRemoteFile: timeout (close event not received)'));
      });
    }, timeoutMs);

    c.client.exec(cmd, (err: Error | undefined, stream: NodeJS.ReadWriteStream | undefined) => {
      if (err) {
        clearTimeout(t);
        fileLog('writeRemoteFile', 'exec err', { message: err.message });
        return settle(() => reject(err));
      }
      if (!stream) {
        clearTimeout(t);
        fileLog('writeRemoteFile', 'reject: no stream');
        return settle(() => reject(new Error('No exec stream')));
      }
      const writable = (stream as { stdin?: NodeJS.WritableStream }).stdin ?? stream;
      const useStdin = !!((stream as { stdin?: NodeJS.WritableStream }).stdin);
      fileLog('writeRemoteFile', 'stream received', { useStdin });
      // 不读取 stdout 可能导致通道无法关闭，必须始终消费
      if (typeof (stream as NodeJS.ReadableStream).resume === 'function') {
        (stream as NodeJS.ReadableStream).resume();
      }
      stream.on('data', () => {});
      const stderr = (stream as { stderr?: NodeJS.ReadableStream }).stderr;
      if (stderr && typeof stderr.resume === 'function') stderr.resume();
      stream.on('close', (code: number) => {
        clearTimeout(t);
        settle(() => {
          fileLog('writeRemoteFile', 'close', { code });
          if (code !== 0) return reject(new Error(`exit ${code}`));
          resolve();
        });
      });
      stream.on('error', (e: Error) => {
        clearTimeout(t);
        settle(() => {
          fileLog('writeRemoteFile', 'stream error', { message: e.message });
          reject(e);
        });
      });
      writable.write(content, 'utf8');
      fileLog('writeRemoteFile', 'write() done');
      writable.end();
      fileLog('writeRemoteFile', 'end() done');
    });
  }));
}

function execCommand(connectionId: number, command: string): Promise<string> {
  const c = connections.get(connectionId);
  if (!c) return Promise.reject(new Error('Not connected'));
  return withExecChannel(() => new Promise((resolve, reject) => {
    c.client.exec(command, (err: Error | undefined, stream: NodeJS.ReadableStream | undefined) => {
      if (err) return reject(err);
      if (!stream) return reject(new Error('No exec stream'));
      let out = '';
      stream.on('data', (chunk: Buffer) => { out += chunk.toString(); });
      const stderr = (stream as { stderr?: NodeJS.ReadableStream }).stderr;
      if (stderr) stderr.on('data', () => {});
      stream.on('close', () => {
        resolve(out.trim());
      });
    });
  }));
}

/** Result of an exec channel command execution. */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Execute a command via SSH exec channel (separate from the interactive PTY shell).
 * Returns clean stdout, stderr, and exit code — no ANSI codes, no echo.
 * Timeout defaults to 30s. Retries once on channel open failure.
 */
export async function execCommandFull(connectionId: number, command: string, timeoutMs: number = 30000): Promise<ExecResult> {
  await acquireExecSlot();
  try {
    const maxRetries = 2;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await execCommandOnce(connectionId, command, timeoutMs);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Channel open failure') || msg.includes('open failed')) {
          if (attempt < maxRetries - 1) {
            console.log(`[execCommandFull] Retry ${attempt + 1} after channel failure: ${command.slice(0, 60)}`);
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            continue;
          }
        }
        throw err;
      }
    }
    throw new Error('Unreachable');
  } finally {
    releaseExecSlot();
  }
}

function execCommandOnce(connectionId: number, command: string, timeoutMs: number): Promise<ExecResult> {
  const c = connections.get(connectionId);
  if (!c) return Promise.reject(new Error('Not connected'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => { if (settled) return; settled = true; fn(); };

    const timer = setTimeout(() => {
      settle(() => reject(new Error(`Command timed out after ${timeoutMs}ms: ${command.slice(0, 80)}`)));
    }, timeoutMs);

    c.client.exec(command, (err: Error | undefined, stream: NodeJS.ReadableStream | undefined) => {
      if (err) { clearTimeout(timer); return settle(() => reject(err)); }
      if (!stream) { clearTimeout(timer); return settle(() => reject(new Error('No exec stream'))); }

      let stdout = '';
      let stderr = '';
      let exitCode: number | null = null;

      stream.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      const stderrStream = (stream as { stderr?: NodeJS.ReadableStream }).stderr;
      if (stderrStream) stderrStream.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      stream.on('close', (code?: number) => {
        clearTimeout(timer);
        exitCode = code ?? null;
        settle(() => resolve({ stdout: stdout.trimEnd(), stderr: stderr.trimEnd(), exitCode }));
      });

      stream.on('error', (e: Error) => {
        clearTimeout(timer);
        settle(() => reject(e));
      });
    });
  });
}

export interface ServerInfo {
  hostname: string;
  os: string;
  kernel: string;
  cpuCores: number;
  cpuModel: string;
  memoryTotal: string;
  memoryUsed: string;
  diskTotal: string;
  diskUsed: string;
  diskPercent: string;
  uptime: string;
  serverTime: string;
}

export async function getServerInfo(connectionId: number): Promise<ServerInfo> {
  console.log(`[serverInfo] Loading server info for connectionId=${connectionId}`);
  // Use throttled execCommandFull to avoid exceeding MaxSessions
  const run = (cmd: string) => execCommandFull(connectionId, cmd, 15000).then(r => r.stdout).catch(() => 'N/A');
  const [hostname, osRelease, kernel, cpuCores, cpuModel, memory, disk, uptime, serverTime] = await Promise.all([
    run('hostname'),
    run('cat /etc/os-release 2>/dev/null | head -5'),
    run('uname -sr'),
    run('nproc'),
    run("cat /proc/cpuinfo 2>/dev/null | grep 'model name' | head -1"),
    run('free -m 2>/dev/null | head -2'),
    run('df -h / 2>/dev/null | tail -1'),
    run('uptime -p 2>/dev/null || uptime'),
    run("date '+%Y-%m-%d %H:%M:%S %Z'"),
  ]);

  const osLine = osRelease.split('\n').find((l) => l.startsWith('PRETTY_NAME'));
  const os = osLine ? osLine.split('=').slice(1).join('=').replace(/"/g, '') : osRelease.split('\n')[0] || 'N/A';

  const cpuModelClean = cpuModel.includes(':') ? cpuModel.split(':').slice(1).join(':').trim() : cpuModel || 'N/A';

  const memParts = memory.split('\n').length >= 2 ? memory.split('\n')[1].trim().split(/\s+/) : [];
  const memoryTotal = memParts.length >= 2 ? `${memParts[1]} MB` : 'N/A';
  const memoryUsed = memParts.length >= 3 ? `${memParts[2]} MB` : 'N/A';

  const diskParts = disk.split(/\s+/);
  const diskTotal = diskParts.length >= 2 ? diskParts[1] : 'N/A';
  const diskUsed = diskParts.length >= 3 ? diskParts[2] : 'N/A';
  const diskPercent = diskParts.length >= 5 ? diskParts[4] : 'N/A';

  return { hostname, os, kernel, cpuCores: parseInt(cpuCores, 10) || 0, cpuModel: cpuModelClean, memoryTotal, memoryUsed, diskTotal, diskUsed, diskPercent, uptime, serverTime };
}
