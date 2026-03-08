import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import path from 'path';
import { loadFirebaseConfig } from './config/loadFirebaseConfig';
import { getLocale, setLocale, type Locale } from './config/userSettings';
import { registerChatHandlers } from './ipc/chatHandler';
import { registerEnvironmentHandlers } from './ipc/environmentHandler';
import { registerExplorerHandlers } from './ipc/explorerHandler';
import { registerLocaleHandlers } from './ipc/localeHandler';
import { registerTerminalHandlers } from './ipc/terminalHandler';
import { startRendererServer } from './server/rendererServer';

let mainWindow: BrowserWindow | null = null;
let rendererServerClose: (() => void) | null = null;

function applyLocaleToWindows(locale: Locale): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('locale-changed', locale);
  });
}

function buildApplicationMenu(): Menu {
  const current = getLocale();
  return Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [{ role: 'quit' as const }],
    },
    { role: 'editMenu' as const },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' as const }, { role: 'zoom' as const }, { role: 'close' as const }],
    },
    {
      label: 'Settings',
      submenu: [
        {
          label: 'Settings...',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents?.send('open-settings');
          },
        },
      ],
    },
    {
      label: 'Help',
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
    title: 'AISSH',
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

  // 認証ポップアップ（Firebase/Google OAuth）のタイトルを「Aissh」に統一
  mainWindow.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: { title: 'Aissh' },
  }));
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
  ipcMain.handle('firebase:getConfig', () => loadFirebaseConfig());
  ipcMain.handle('openExternal', (_event, url: string) => {
    if (typeof url === 'string' && url.startsWith('https://')) shell.openExternal(url);
  });
  registerEnvironmentHandlers();
  registerChatHandlers();
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
      console.error('[main] Renderer server failed, falling back to loadFile. Firebase Auth may not work:', err);
    }
  }

  createWindow(rendererUrl);
  Menu.setApplicationMenu(buildApplicationMenu());
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
