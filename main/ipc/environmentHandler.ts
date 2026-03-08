import { ipcMain } from 'electron';
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
}
