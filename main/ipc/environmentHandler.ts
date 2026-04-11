import { ipcMain } from 'electron';
import net from 'net';
import * as environmentRepo from '../database/environmentRepo';

export function registerEnvironmentHandlers(): void {
  ipcMain.handle('environment:list', () => {
    return environmentRepo.listEnvironment();
  });

  ipcMain.handle('environment:create', (_event, input: environmentRepo.CreateEnvironmentInput) => {
    return environmentRepo.createEnvironment(input);
  });

  ipcMain.handle('environment:update', (_event, id: number, input: Partial<environmentRepo.CreateEnvironmentInput>) => {
    return environmentRepo.updateEnvironment(id, input);
  });

  ipcMain.handle('environment:delete', (_event, id: number) => {
    return environmentRepo.deleteEnvironment(id);
  });

  ipcMain.handle('environment:testConnection', (_event, host: string, port: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timer = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, 5000);
      socket.connect(port, host, () => {
        clearTimeout(timer);
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  });
}
