import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import path from 'path';
import { getLocale, type Locale } from './config/userSettings';
import { registerChatHandlers, registerAiSettingsHandlers } from './ipc/chatHandler';
import { registerEnvironmentHandlers } from './ipc/environmentHandler';
import { registerExplorerHandlers } from './ipc/explorerHandler';
import { registerLocaleHandlers, loadLangJson, onLocaleChanged } from './ipc/localeHandler';
import { registerTerminalHandlers } from './ipc/terminalHandler';
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
      submenu: [{ role: 'quit' as const }],
    },
    { role: 'editMenu' as const },
    {
      label: t('menu.window'),
      submenu: [{ role: 'minimize' as const }, { role: 'zoom' as const }, { role: 'close' as const }],
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
      submenu: [{ role: 'about' as const }],
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

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {});
    mainWindow.webContents.openDevTools();
  } else if (rendererUrl) {
    mainWindow.loadURL(rendererUrl).catch(() => {});
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
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
