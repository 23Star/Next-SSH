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
  ipcMain.handle('explorer:getHome', async (_event, connectionIdJson: string) => {
    return JSON.stringify(await sshConnection.getHome(JSON.parse(connectionIdJson)));
  });

  ipcMain.handle('explorer:listDirectory', async (_event, connectionIdJson: string, dirPathJson: string) => {
    return JSON.stringify(await sshConnection.listDirectory(JSON.parse(connectionIdJson), JSON.parse(dirPathJson)));
  });

  ipcMain.handle('explorer:getLocalHome', async () => {
    return JSON.stringify(PC_ROOT);
  });

  ipcMain.handle('explorer:getLocalParent', async (_event, dirPathJson: string) => {
    const dirPath: string = JSON.parse(dirPathJson);
    if (dirPath === PC_ROOT) return JSON.stringify(PC_ROOT);
    const resolved = path.resolve(dirPath);
    if (isDriveRoot(resolved)) return JSON.stringify(PC_ROOT);
    const parent = path.resolve(resolved, '..');
    if (parent === resolved) return JSON.stringify(resolved);
    if (isDriveRoot(parent)) return JSON.stringify(PC_ROOT);
    return JSON.stringify(parent);
  });

  ipcMain.handle('explorer:listLocalDirectory', async (_event, dirPathJson: string) => {
    const dirPath: string = JSON.parse(dirPathJson);
    if (dirPath === PC_ROOT) {
      return JSON.stringify(getLocalDrives());
    }
    const resolved = path.resolve(dirPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error('Not a directory');
    }
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const result = entries
      .filter((e) => e.name !== '.' && e.name !== '..')
      .map((e) => {
        try {
          const fullPath = path.join(resolved, e.name);
          const stat = fs.statSync(fullPath);
          const size = stat.isDirectory() ? '' : formatLocalSize(stat.size);
          const mtime = stat.mtime.toISOString().slice(0, 16).replace('T', ' ');
          const perms = formatPermissions(stat.mode);
          return { name: e.name, isDirectory: e.isDirectory(), size, mtime, permissions: perms };
        } catch {
          return { name: e.name, isDirectory: e.isDirectory() };
        }
      })
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
    return JSON.stringify(result);
  });

  ipcMain.handle('explorer:readLocalFile', async (_event, filePathJson: string) => {
    const filePath: string = JSON.parse(filePathJson);
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) throw new Error('File not found');
    if (!fs.statSync(resolved).isFile()) throw new Error('Not a file');
    return JSON.stringify(fs.readFileSync(resolved, 'utf8'));
  });

  ipcMain.handle('explorer:writeLocalFile', async (_event, filePathJson: string, contentJson: string) => {
    const filePath: string = JSON.parse(filePathJson);
    const content: string = JSON.parse(contentJson);
    const resolved = path.resolve(filePath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('Directory not found');
    fs.writeFileSync(resolved, content, 'utf8');
  });

  ipcMain.handle('explorer:renamePath', (_event, oldPathJson: string, newNameJson: string) => {
    const oldPath: string = JSON.parse(oldPathJson);
    const newName: string = JSON.parse(newNameJson);
    const normalized = path.normalize(oldPath.replace(/\//g, path.sep));
    const resolvedOld = path.resolve(normalized);
    const parent = path.dirname(resolvedOld);
    const resolvedNew = path.join(parent, newName);
    if (!fs.existsSync(resolvedOld)) throw new Error('File or folder not found');
    fs.renameSync(resolvedOld, resolvedNew);
  });

  ipcMain.handle('explorer:deletePath', (_event, filePathJson: string) => {
    const filePath: string = JSON.parse(filePathJson);
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

  ipcMain.handle('explorer:readRemoteFile', async (_event, connectionIdJson: string, remotePathJson: string) => {
    return JSON.stringify(await sshConnection.readRemoteFile(JSON.parse(connectionIdJson), JSON.parse(remotePathJson)));
  });

  ipcMain.handle('explorer:getRemoteFileSize', async (_event, connectionIdJson: string, remotePathJson: string) => {
    return JSON.stringify(await sshConnection.getFileSize(JSON.parse(connectionIdJson), JSON.parse(remotePathJson)));
  });

  ipcMain.handle('explorer:getLocalFileSize', async (_event, filePathJson: string) => {
    const filePath: string = JSON.parse(filePathJson);
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) return JSON.stringify(0);
    const stat = fs.statSync(resolved);
    return JSON.stringify(stat.isFile() ? stat.size : 0);
  });

  ipcMain.handle('explorer:writeRemoteFile', async (_event, connectionIdJson: string, remotePathJson: string, contentJson: string) => {
    return sshConnection.writeRemoteFile(JSON.parse(connectionIdJson), JSON.parse(remotePathJson), JSON.parse(contentJson));
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

  ipcMain.handle('explorer:copyToFolder', (_event, sourcePathsJson: string, targetDirJson: string) => {
    const sourcePaths: string[] = JSON.parse(sourcePathsJson);
    const targetDir: string = JSON.parse(targetDirJson);
    console.log('[explorer] copyToFolder called, sources:', sourcePaths.length, 'target:', targetDir);
    copyToFolderInternal(sourcePaths, targetDir);
    console.log('[explorer] copyToFolder done');
  });

  ipcMain.handle('explorer:downloadToDestination', async (event, sourcePathsJson: string) => {
    const sourcePaths: string[] = JSON.parse(sourcePathsJson);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return JSON.stringify({ ok: false });
    console.log('[explorer] downloadToDestination sources:', sourcePaths);
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: '保存先を選択',
    });
    if (result.canceled || !result.filePaths.length) {
      console.log('[explorer] downloadToDestination canceled or no path');
      return JSON.stringify({ ok: false });
    }
    const targetDir = result.filePaths[0];
    console.log('[explorer] downloadToDestination target:', targetDir);
    try {
      copyToFolderInternal(sourcePaths, targetDir);
      console.log('[explorer] downloadToDestination done');
      return JSON.stringify({ ok: true });
    } catch (err) {
      console.log('[explorer] downloadToDestination error:', err);
      return JSON.stringify({ ok: false });
    }
  });

  ipcMain.handle('explorer:downloadFromRemote', async (event, connectionIdJson: string, remotePathsJson: string) => {
    const connectionId: number = JSON.parse(connectionIdJson);
    const remotePaths: string[] = JSON.parse(remotePathsJson);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return JSON.stringify({ ok: false });
    console.log('[explorer] downloadFromRemote connectionId:', connectionId, 'sources:', remotePaths);
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: '保存先を選択',
    });
    if (result.canceled || !result.filePaths.length) {
      console.log('[explorer] downloadFromRemote canceled');
      return JSON.stringify({ ok: false });
    }
    const localDir = result.filePaths[0];
    try {
      await sshConnection.downloadToLocal(connectionId, remotePaths, localDir);
      console.log('[explorer] downloadFromRemote done');
      return JSON.stringify({ ok: true });
    } catch (err) {
      console.log('[explorer] downloadFromRemote error:', err);
      return JSON.stringify({ ok: false });
    }
  });

  ipcMain.handle('explorer:uploadToRemote', async (_event, connectionIdJson: string, localPathsJson: string, remoteDirJson: string) => {
    const connectionId: number = JSON.parse(connectionIdJson);
    const localPaths: string[] = JSON.parse(localPathsJson);
    const remoteDir: string = JSON.parse(remoteDirJson);
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

function formatLocalSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

function formatPermissions(mode: number): string {
  const perms = ['r', 'w', 'x'];
  const result: string[] = [];
  const typeChar = (mode & 0o170000) === 0o040000 ? 'd' : '-';
  result.push(typeChar);
  for (let shift = 6; shift >= 0; shift -= 3) {
    for (let i = 0; i < 3; i++) {
      result.push((mode >> (shift + (2 - i))) & 1 ? perms[i] : '-');
    }
  }
  return result.join('');
}
