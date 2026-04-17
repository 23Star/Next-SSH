import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import path from 'path';
import { getLocale, type Locale } from './config/userSettings';
import { registerChatHandlers, registerAiSettingsHandlers } from './ipc/chatHandler';
import { registerEnvironmentHandlers } from './ipc/environmentHandler';
import { registerExplorerHandlers } from './ipc/explorerHandler';
import { registerLocaleHandlers, loadLangJson, onLocaleChanged } from './ipc/localeHandler';
import { registerTerminalHandlers } from './ipc/terminalHandler';
import { registerServerInfoHandlers } from './ipc/serverInfoHandler';
import { startRendererServer } from './server/rendererServer';

let mainWindow: BrowserWindow | null = null;
let rendererServerClose: (() => void) | null = null;

function buildApplicationMenu(): Menu {
  const locale = getLocale();
  const pack = loadLangJson()[locale] ?? loadLangJson()['en'] ?? {};
  const t = (key: string): string => pack[key] ?? key;
  return Menu.buildFromTemplate([
    {
      label: t('menu.file'),
      submenu: [
        { label: t('menu.quit'), accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: t('menu.edit'),
      submenu: [
        { label: t('menu.undo'), accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: t('menu.redo'), accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
        { type: 'separator' as const },
        { label: t('menu.cut'), accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: t('menu.copy'), accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: t('menu.paste'), accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: t('menu.selectAll'), accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
      ],
    },
    {
      label: t('menu.window'),
      submenu: [
        { label: t('menu.minimize'), accelerator: 'CmdOrCtrl+M', role: 'minimize' },
        { label: t('menu.zoom'), role: 'zoom' },
        { label: t('menu.close'), accelerator: 'CmdOrCtrl+W', role: 'close' },
      ],
    },
    {
      label: t('menu.settings'),
      submenu: [
        {
          label: t('menu.settingsOpen'),
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents?.send('open-settings');
          },
        },
      ],
    },
    {
      label: t('menu.help'),
      submenu: [{ label: t('menu.about'), role: 'about' }],
    },
  ]);
}

function createWindow(rendererUrl: string | null): void {
  const isDev = process.env.NODE_ENV === 'development';
  const preloadPath = path.join(__dirname, '../preload/index.js');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
    },
    title: 'Next-SSH',
  });

  // Phase 2+ dual-entry switch. Set NEXT_SSH_V2=1 to load the new iOS+Claude UI.
  // Default stays on the legacy UI until the new one is feature-complete.
  const v2Flag = process.env.NEXT_SSH_V2 === '1';
  const devPath = v2Flag ? 'v2/' : '';
  const prodHtml = v2Flag ? '../renderer/v2/index.html' : '../renderer/index.html';

  if (isDev) {
    mainWindow.loadURL(`http://localhost:5173/${devPath}`).catch(() => {});
    mainWindow.webContents.openDevTools();
  } else if (rendererUrl) {
    const url = v2Flag ? rendererUrl.replace(/\/?$/, '/v2/') : rendererUrl;
    mainWindow.loadURL(url).catch(() => {});
  } else {
    mainWindow.loadFile(path.join(__dirname, prodHtml));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  ipcMain.handle('ping', () => 'pong');
  ipcMain.handle('log:toMain', (_event, ...args: unknown[]) => {
    console.log('[renderer]', ...args);
  });
  ipcMain.handle('window:refocus', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      win.blur();
      win.focus();
    }
  });
  ipcMain.handle('openExternal', (_event, url: string) => {
    if (typeof url === 'string' && url.startsWith('https://')) shell.openExternal(url);
  });
  registerEnvironmentHandlers();
  registerChatHandlers();
  registerAiSettingsHandlers();
  registerExplorerHandlers();
  registerLocaleHandlers();
  registerServerInfoHandlers();

  let rendererUrl: string | null = null;
  if (process.env.NODE_ENV !== 'development') {
    const rendererDir = path.join(__dirname, '../renderer');
    const portFilePath = path.join(app.getPath('userData'), 'renderer-port.json');
    try {
      const { url, close } = await startRendererServer(rendererDir, portFilePath);
      rendererUrl = url;
      rendererServerClose = close;
    } catch (err) {
      console.error('[main] Renderer server failed, falling back to loadFile:', err);
    }
  }

  createWindow(rendererUrl);
  Menu.setApplicationMenu(buildApplicationMenu());
  onLocaleChanged(() => Menu.setApplicationMenu(buildApplicationMenu()));
  if (mainWindow) registerTerminalHandlers(mainWindow.webContents);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(rendererUrl);
      if (mainWindow) registerTerminalHandlers(mainWindow.webContents);
    }
  });
});

app.on('before-quit', () => {
  if (rendererServerClose) {
    rendererServerClose();
    rendererServerClose = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (rendererServerClose) {
      rendererServerClose();
      rendererServerClose = null;
    }
    app.quit();
  }
});
