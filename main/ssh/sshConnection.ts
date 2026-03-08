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

/** PTY のウィンドウサイズをサーバーに通知（vim 等の縦幅を正しくする） */
export function resize(connectionId: number, rows: number, cols: number, height?: number, width?: number): boolean {
  const c = connections.get(connectionId);
  if (!c?.stream.setWindow) return false;
  const h = typeof height === 'number' && height > 0 ? height : 480;
  const w = typeof width === 'number' && width > 0 ? width : 640;
  c.stream.setWindow(rows, cols, h, w);
  return true;
}

/** 接続中で echo $HOME を実行してホームディレクトリパスを取得する。 */
export function getHome(connectionId: number): Promise<string> {
  const c = connections.get(connectionId);
  if (!c) return Promise.reject(new Error('Not connected'));
  return new Promise((resolve, reject) => {
    c.client.exec('echo $HOME', (err: Error | undefined, stream: NodeJS.ReadableStream | undefined) => {
      if (err) return reject(err);
      if (!stream) return reject(new Error('No exec stream'));
      let out = '';
      stream.on('data', (chunk: Buffer) => {
        out += chunk.toString();
      });
      const stderr = (stream as { stderr?: NodeJS.ReadableStream }).stderr;
      if (stderr) stderr.on('data', () => {});
      stream.on('close', (code: number) => {
        if (code !== 0) return reject(new Error(`exit ${code}`));
        resolve(out.trim());
      });
    });
  });
}

export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

/** 接続中で指定パスのディレクトリ一覧を SFTP で取得する。 */
export function listDirectory(connectionId: number, dirPath: string): Promise<DirEntry[]> {
  const c = connections.get(connectionId);
  if (!c) return Promise.reject(new Error('Not connected'));
  return new Promise((resolve, reject) => {
    c.client.sftp((err: Error | undefined, sftp: { readdir: (p: string, cb: (e: Error | undefined, list: unknown) => void) => void; end: () => void } | undefined) => {
      if (err) return reject(err);
      if (!sftp) return reject(new Error('No SFTP'));
      sftp.readdir(dirPath, (errRead: Error | undefined, list: unknown) => {
        sftp.end();
        if (errRead) return reject(errRead);
        const arr = Array.isArray(list) ? list as Array<{ filename: string; attrs?: { mode?: number } }> : [];
        const result: DirEntry[] = arr
          .filter((e) => e.filename !== '.' && e.filename !== '..')
          .map((e) => ({
            name: e.filename,
            isDirectory: ((e.attrs?.mode ?? 0) & 0o170000) === 0o040000,
          }))
          .sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
          });
        resolve(result);
      });
    });
  });
}

function isDirMode(mode: number): boolean {
  return (mode & 0o170000) === 0o040000;
}

/** リモートのファイル/フォルダをローカルにダウンロード。sftp は呼び出し元で開いたまま。 */
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

/** リモートから指定パスをローカルフォルダにダウンロード（再帰対応）。 */
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

/** ローカルのファイル/フォルダをリモートにアップロード。remoteDir は末尾 / なし。 */
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

/** ローカルパスをリモートの指定フォルダにアップロード（再帰対応）。 */
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

/** シェルでパスをエスケープ（単一引用符で囲み、中の ' は '\'' に）。 */
function escapePathForShell(remotePath: string): string {
  return "'" + remotePath.replace(/'/g, "'\\''") + "'";
}

/** リモートのテキストファイルを読み取り（UTF-8）。エディタ用。 */
export function readRemoteFile(connectionId: number, remotePath: string): Promise<string> {
  fileLog('readRemoteFile', 'start', { connectionId, remotePath });
  const c = connections.get(connectionId);
  if (!c) {
    fileLog('readRemoteFile', 'reject: not connected', { connectionId });
    return Promise.reject(new Error('Not connected'));
  }
  return new Promise((resolve, reject) => {
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
      fileLog('readRemoteFile', 'stream received', { hasStdin: 'stdin' in stream && !!stream.stdin });
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
  });
}

/** リモートにテキストファイルを書き込み（UTF-8）。エディタ保存用。 */
export function writeRemoteFile(connectionId: number, remotePath: string, content: string): Promise<void> {
  fileLog('writeRemoteFile', 'start', { connectionId, remotePath, contentLen: content.length });
  const c = connections.get(connectionId);
  if (!c) {
    fileLog('writeRemoteFile', 'reject: not connected', { connectionId });
    return Promise.reject(new Error('Not connected'));
  }
  return new Promise((resolve, reject) => {
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
      // stdout を読まないとチャネルが close しないことがあるので、必ず消費する
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
  });
}
