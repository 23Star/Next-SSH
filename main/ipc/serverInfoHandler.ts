import { ipcMain } from 'electron';
import * as sshConnection from '../ssh/sshConnection';

export function registerServerInfoHandlers(): void {
  ipcMain.handle('serverInfo:get', async (_event, connectionId: number) => {
    return sshConnection.getServerInfo(connectionId);
  });
}
