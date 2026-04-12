import { ipcMain, type WebContents } from 'electron';
import { getEnvironmentById } from '../database/environmentRepo';
import * as localTerminal from '../localTerminal';
import * as sshConnection from '../ssh/sshConnection';
import * as localExec from '../localExec';

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

  ipcMain.handle('terminal:localWrite', (_event, tabId: string, dataObj: { v: string }) => {
    return localTerminal.writeLocal(tabId, dataObj.v);
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

  ipcMain.handle('terminal:write', (_event, connectionId: number, dataObj: { v: string }) => {
    const data = dataObj?.v ?? '';
    return sshConnection.write(connectionId, data);
  });

  ipcMain.handle(
    'terminal:resize',
    (_event, connectionId: number, rows: number, cols: number, height?: number, width?: number) => {
      return sshConnection.resize(connectionId, rows, cols, height, width);
    },
  );

  // Exec a command via SSH exec channel (clean output, no PTY echo/ANSI)
  ipcMain.handle(
    'terminal:exec',
    async (_event, connectionId: number, commandObj: { v: string }, timeoutMs?: number) => {
      const command = commandObj?.v ?? '';
      return sshConnection.execCommandFull(connectionId, command, timeoutMs ?? 30000);
    },
  );

  // Exec a command on the local machine via child_process.exec
  ipcMain.handle(
    'terminal:localExec',
    async (_event, commandObj: { v: string }, timeoutMs?: number) => {
      const command = commandObj?.v ?? '';
      return localExec.execLocal(command, timeoutMs ?? 30000);
    },
  );
}
