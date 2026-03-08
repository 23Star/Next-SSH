import { BrowserWindow, dialog, ipcMain, nativeImage } from 'electron';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as sshConnection from '../ssh/sshConnection';

/** 「PC」ルート（ドライブ一覧など）を表す特別なパス。 */
const PC_ROOT = '\0pc';

function getLocalDrives(): Array<{ name: string; isDirectory: boolean }> {
  if (os.platform() !== 'win32') {
    return [{ name: path.sep, isDirectory: true }];
  }
  let out: string;
  try {
    out = execSync('wmic logicaldisk get name', { encoding: 'utf8', maxBuffer: 4096 });
  } catch {
    try {
      out = execSync(
        'powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | ForEach-Object { $_.Root }"',
        { encoding: 'utf8', maxBuffer: 4096 },
      );
    } catch {
      return [{ name: 'C:\\', isDirectory: true }];
    }
  }
  const drives = out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && s !== 'Name')
    .map((d) => (d.endsWith(path.sep) ? d : d + path.sep));
  return drives.map((d) => ({ name: d, isDirectory: true }));
}

function isDriveRoot(p: string): boolean {
  if (os.platform() !== 'win32') return p === path.sep || p === '/';
  const resolved = path.resolve(p);
  return /^[A-Za-z]:\\?$/.test(resolved) && resolved.length <= 3;
}

export function registerExplorerHandlers(): void {
  ipcMain.handle('explorer:getHome', async (_event, connectionId: number) => {
    return sshConnection.getHome(connectionId);
  });

  ipcMain.handle('explorer:listDirectory', async (_event, connectionId: number, dirPath: string) => {
    return sshConnection.listDirectory(connectionId, dirPath);
  });

  ipcMain.handle('explorer:getLocalHome', async () => {
    return PC_ROOT;
  });

  ipcMain.handle('explorer:getLocalParent', async (_event, dirPath: string) => {
    if (dirPath === PC_ROOT) return PC_ROOT;
    const resolved = path.resolve(dirPath);
    if (isDriveRoot(resolved)) return PC_ROOT;
    const parent = path.resolve(resolved, '..');
    if (parent === resolved) return resolved;
    if (isDriveRoot(parent)) return PC_ROOT;
    return parent;
  });

  ipcMain.handle('explorer:listLocalDirectory', async (_event, dirPath: string) => {
    if (dirPath === PC_ROOT) {
      return getLocalDrives();
    }
    const resolved = path.resolve(dirPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error('Not a directory');
    }
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    return entries
      .filter((e) => e.name !== '.' && e.name !== '..')
      .map((e) => ({ name: e.name, isDirectory: e.isDirectory() }))
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
  });

  /** ローカルファイルを UTF-8 で読み取り（エディタ用）。 */
  ipcMain.handle('explorer:readLocalFile', async (_event, filePath: string) => {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) throw new Error('File not found');
    if (!fs.statSync(resolved).isFile()) throw new Error('Not a file');
    return fs.readFileSync(resolved, 'utf8');
  });

  /** ローカルファイルを UTF-8 で書き込み（エディタ保存用）。 */
  ipcMain.handle('explorer:writeLocalFile', async (_event, filePath: string, content: string) => {
    const resolved = path.resolve(filePath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('Directory not found');
    fs.writeFileSync(resolved, content, 'utf8');
  });

  /** ローカルでリネーム（ファイル・フォルダ）。 */
  ipcMain.handle('explorer:renamePath', (_event, oldPath: string, newName: string) => {
    const normalized = path.normalize(oldPath.replace(/\//g, path.sep));
    const resolvedOld = path.resolve(normalized);
    const parent = path.dirname(resolvedOld);
    const resolvedNew = path.join(parent, newName);
    if (!fs.existsSync(resolvedOld)) throw new Error('File or folder not found');
    fs.renameSync(resolvedOld, resolvedNew);
  });

  /** ローカルで削除（ファイルは unlink、フォルダは再帰削除）。 */
  ipcMain.handle('explorer:deletePath', (_event, filePath: string) => {
    const normalized = path.normalize(filePath.replace(/\//g, path.sep));
    const resolved = path.resolve(normalized);
    if (!fs.existsSync(resolved)) throw new Error('Not found');
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      fs.rmSync(resolved, { recursive: true });
    } else {
      fs.unlinkSync(resolved);
    }
  });

  /** リモート（SSH）のテキストファイルを読み取り（エディタ用）。 */
  ipcMain.handle('explorer:readRemoteFile', async (_event, connectionId: number, remotePath: string) => {
    return sshConnection.readRemoteFile(connectionId, remotePath);
  });

  /** リモート（SSH）にテキストファイルを書き込み（エディタ保存用）。 */
  ipcMain.handle('explorer:writeRemoteFile', async (_event, connectionId: number, remotePath: string, content: string) => {
    return sshConnection.writeRemoteFile(connectionId, remotePath, content);
  });

  /** ドラッグ用の小さなアイコン（1x1 PNG）。icon にファイルパスを渡すとフォルダ等で "Failed to load image" になるため。 */
  const DRAG_ICON_DATAURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  /** Phase1: AISSH(PC) → 他アプリへドラッグ。Windows では startDrag がクラッシュする既知不具合のため無効化。 */
  ipcMain.handle('explorer:startDrag', (event, filePath: string) => {
    if (os.platform() === 'win32') {
      console.log('[explorer] startDrag skipped on Windows (known crash)');
      return;
    }
    console.log('[explorer] startDrag called, filePath:', filePath);
    const resolved = path.normalize(path.resolve(filePath));
    if (!fs.existsSync(resolved)) {
      console.log('[explorer] startDrag skip: path does not exist');
      return;
    }
    try {
      const icon = nativeImage.createFromDataURL(DRAG_ICON_DATAURL);
      event.sender.startDrag({ file: resolved, icon });
      console.log('[explorer] startDrag done:', resolved);
    } catch (err) {
      console.log('[explorer] startDrag error:', err);
    }
  });

  /** 指定フォルダへファイル/フォルダをコピー（共通処理）。ドロップ・ダウンロード両方で利用。 */
  function copyToFolderInternal(sourcePaths: string[], targetDir: string): void {
    const target = path.resolve(targetDir);
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
      throw new Error('Target is not a directory');
    }
    for (const src of sourcePaths) {
      const normalized = path.normalize(src.replace(/\//g, path.sep));
      const resolvedSrc = path.resolve(normalized);
      if (!fs.existsSync(resolvedSrc)) {
        console.log('[explorer] copy skip (not found):', resolvedSrc);
        continue;
      }
      const name = path.basename(resolvedSrc);
      const dest = path.join(target, name);
      const stat = fs.statSync(resolvedSrc);
      if (stat.isDirectory()) {
        fs.cpSync(resolvedSrc, dest, { recursive: true });
      } else {
        fs.copyFileSync(resolvedSrc, dest);
      }
      console.log('[explorer] copy ok:', resolvedSrc, '->', dest);
    }
  }

  /** Phase1: 他アプリ（Explorer等）からドロップしたファイルを指定フォルダにコピー。 */
  ipcMain.handle('explorer:copyToFolder', (_event, sourcePaths: string[], targetDir: string) => {
    console.log('[explorer] copyToFolder called, sources:', sourcePaths.length, 'target:', targetDir);
    copyToFolderInternal(sourcePaths, targetDir);
    console.log('[explorer] copyToFolder done');
  });

  /** 右クリック「ダウンロード」: 保存先フォルダを選んでコピー。Phase1 はローカル（PC）のみ。 */
  ipcMain.handle('explorer:downloadToDestination', async (event, sourcePaths: string[]) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { ok: false as const };
    console.log('[explorer] downloadToDestination sources:', sourcePaths);
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: '保存先を選択',
    });
    if (result.canceled || !result.filePaths.length) {
      console.log('[explorer] downloadToDestination canceled or no path');
      return { ok: false as const };
    }
    const targetDir = result.filePaths[0];
    console.log('[explorer] downloadToDestination target:', targetDir);
    try {
      copyToFolderInternal(sourcePaths, targetDir);
      console.log('[explorer] downloadToDestination done');
      return { ok: true as const };
    } catch (err) {
      console.log('[explorer] downloadToDestination error:', err);
      return { ok: false as const };
    }
  });

  /** リモート（SSH）のファイルを右クリック「ダウンロード」: 保存先を選んで SFTP で取得。 */
  ipcMain.handle('explorer:downloadFromRemote', async (event, connectionId: number, remotePaths: string[]) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { ok: false as const };
    console.log('[explorer] downloadFromRemote connectionId:', connectionId, 'sources:', remotePaths);
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: '保存先を選択',
    });
    if (result.canceled || !result.filePaths.length) {
      console.log('[explorer] downloadFromRemote canceled');
      return { ok: false as const };
    }
    const localDir = result.filePaths[0];
    try {
      await sshConnection.downloadToLocal(connectionId, remotePaths, localDir);
      console.log('[explorer] downloadFromRemote done');
      return { ok: true as const };
    } catch (err) {
      console.log('[explorer] downloadFromRemote error:', err);
      return { ok: false as const };
    }
  });

  /** Explorer 等からリモート（SSH）パネルへドロップ: ローカルファイルを SFTP でアップロード。 */
  ipcMain.handle('explorer:uploadToRemote', async (_event, connectionId: number, localPaths: string[], remoteDir: string) => {
    console.log('[explorer] uploadToRemote connectionId:', connectionId, 'sources:', localPaths.length, 'target:', remoteDir);
    try {
      await sshConnection.uploadToRemote(connectionId, localPaths, remoteDir);
      console.log('[explorer] uploadToRemote done');
    } catch (err) {
      console.log('[explorer] uploadToRemote error:', err);
      throw err;
    }
  });
}
