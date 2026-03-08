import { ipcMain } from 'electron';
import * as chatSessionRepo from '../database/chatSessionRepo';
import * as chatContextRepo from '../database/chatContextRepo';
import * as serveroutputContextRepo from '../database/serveroutputContextRepo';

export interface ChatMessagePayload {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function registerChatHandlers(): void {
  ipcMain.handle('chat:complete', async () => {
    throw new Error('チャット機能を使うにはログインしてください。');
  });

  ipcMain.handle('chatSession:list', async () => chatSessionRepo.listChatSessions());
  ipcMain.handle('chatSession:create', async (_event, title?: string | null) =>
    chatSessionRepo.createChatSession(title),
  );
  ipcMain.handle('chatSession:update', async (_event, id: number, input: { title?: string }) =>
    chatSessionRepo.updateChatSession(id, input),
  );
  ipcMain.handle('chatSession:delete', async (_event, id: number) => chatSessionRepo.deleteChatSession(id));

  ipcMain.handle('chatContext:listBySession', async (_event, sessionId: number) =>
    chatContextRepo.listChatContextBySessionId(sessionId),
  );
  ipcMain.handle(
    'chatContext:add',
    async (
      _event,
      sessionId: number,
      role: string,
      content: string,
      suggestedCommands?: string[] | null,
    ) => chatContextRepo.addChatContext(sessionId, role, content, suggestedCommands),
  );
  ipcMain.handle('chatContext:deleteByIds', async (_event, ids: number[]) =>
    chatContextRepo.deleteChatContextByIds(ids),
  );

  ipcMain.handle('serveroutput:get', async (_event, connectionId: number) => {
    return serveroutputContextRepo.getServeroutputContextByConnectionId(connectionId);
  });
  ipcMain.handle('serveroutput:append', async (_event, connectionId: number, data: string) => {
    serveroutputContextRepo.appendServeroutputContextByConnectionId(connectionId, data);
  });
}
