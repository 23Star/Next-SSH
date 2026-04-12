import { ipcMain, type WebContents } from 'electron';
import { getEnvironmentById } from '../database/environmentRepo';
import * as localTerminal from '../localTerminal';
import * as sshConnection from '../ssh/sshConnection';

let sendToRenderer: ((connectionId: number, data: string) => void) | null = null;

export function registerTerminalHandlers(webContents: WebContents): void {
  sendToRenderer = (connectionId: number, data: string) => {
    webContents.send('terminal:data', { connectionId, data });
  };

  ipcMain.handle('terminal:localConnect', (_event, tabId: string) => {
    localTerminal.spawnLocal(tabId, (id, data) => {
      webContents.send('terminal:localData', { tabId: id, data });
    });
  });

  ipcMain.handle('terminal:localWrite', (_event, tabId: string, data: string) => {
    return localTerminal.writeLocal(tabId, data);
  });

  ipcMain.handle('terminal:localResize', (_event, tabId: string, cols: number, rows: number) => {
    return localTerminal.resizeLocal(tabId, cols, rows);
  });

  ipcMain.handle('terminal:localDisconnect', (_event, tabId: string) => {
    localTerminal.disconnectLocal(tabId);
  });

  ipcMain.handle(
    'terminal:connect',
    async (_event, connectionId: number, envId: number, passphrase: string | null) => {
      const env = getEnvironmentById(envId);
      if (!env) throw new Error('Environment not found');
      if (!sendToRenderer) throw new Error('Not ready');
      await sshConnection.connect(connectionId, env, passphrase, sendToRenderer);
    },
  );

  ipcMain.handle('terminal:disconnect', (_event, connectionId: number) => {
    sshConnection.disconnect(connectionId);
  });

  ipcMain.handle('terminal:write', (_event, connectionId: number, data: string) => {
    return sshConnection.write(connectionId, data);
  });

  ipcMain.handle(
    'terminal:resize',
    (_event, connectionId: number, rows: number, cols: number, height?: number, width?: number) => {
      return sshConnection.resize(connectionId, rows, cols, height, width);
    },
  );
}
