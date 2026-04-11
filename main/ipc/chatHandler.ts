import { ipcMain } from 'electron';
import * as chatSessionRepo from '../database/chatSessionRepo';
import * as chatContextRepo from '../database/chatContextRepo';
import * as serveroutputContextRepo from '../database/serveroutputContextRepo';
import * as aiSettings from '../config/aiSettings';

export interface ChatMessagePayload {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function callOpenAiCompatibleApi(
  messages: ChatMessagePayload[],
): Promise<string> {
  const settings = aiSettings.getAiSettings();
  if (!settings.apiUrl || !settings.apiKey || !settings.model) {
    throw new Error('AI が設定されていません。設定で API URL、API Key、Model を入力してください。');
  }

  const baseUrl = settings.apiUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;

  const body: Record<string, unknown> = {
    model: settings.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };
  if (settings.temperature > 0) {
    body.temperature = settings.temperature;
  }
  if (settings.maxTokens > 0) {
    body.max_tokens = settings.maxTokens;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`API エラー (${response.status}): ${errorText || response.statusText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };

  if (data.error?.message) {
    throw new Error(`API エラー: ${data.error.message}`);
  }

  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('API からの応答が空でした。');
  }

  return content;
}

export function registerChatHandlers(): void {
  ipcMain.handle('chat:complete', async (_event, messages: ChatMessagePayload[]) => {
    return callOpenAiCompatibleApi(messages);
  });

  ipcMain.handle('chatSession:list', async () => chatSessionRepo.listChatSessions());
  ipcMain.handle('chatSession:create', async (_event, title?: string | null) =>
    chatSessionRepo.createChatSession(title),
  );
  ipcMain.handle('chatSession:update', async (_event, id: number, input: { title?: string }) =>
    chatSessionRepo.updateChatSession(id, input),
  );
  ipcMain.handle('chatSession:delete', async (_event, id: number) =>
    chatSessionRepo.deleteChatSession(id),
  );

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

export function registerAiSettingsHandlers(): void {
  ipcMain.handle('aiSettings:get', async () => {
    return aiSettings.getAiSettingsDisplay();
  });

  ipcMain.handle('aiSettings:set', async (_event, input: aiSettings.AiSettingsInput) => {
    aiSettings.setAiSettings(input);
  });

  ipcMain.handle('aiSettings:test', async () => {
    try {
      const settings = aiSettings.getAiSettings();
      if (!settings.apiUrl || !settings.apiKey || !settings.model) {
        return { ok: false, message: 'API URL、API Key、Model をすべて入力してください。' };
      }
      const result = await callOpenAiCompatibleApi([
        { role: 'user', content: 'Hello' },
      ]);
      const preview = result.length > 50 ? result.slice(0, 50) + '...' : result;
      return { ok: true, message: `接続成功: "${preview}"` };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle('aiSettings:isConfigured', async () => {
    return aiSettings.isAiConfigured();
  });
}
