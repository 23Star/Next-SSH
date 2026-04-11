import { ipcMain, IpcMainInvokeEvent } from 'electron';
import * as chatSessionRepo from '../database/chatSessionRepo';
import * as chatContextRepo from '../database/chatContextRepo';
import * as serveroutputContextRepo from '../database/serveroutputContextRepo';
import * as aiSettings from '../config/aiSettings';

export interface ChatMessagePayload {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface StreamChunkPayload {
  type: 'content' | 'thinking' | 'done' | 'error';
  text: string;
}

async function callOpenAiCompatibleApi(
  messages: ChatMessagePayload[],
  stream: boolean = false,
): Promise<Response> {
  const settings = aiSettings.getAiSettings();
  if (!settings.apiUrl || !settings.apiKey || !settings.model) {
    throw new Error('AI 未配置。请在设置中配置 API URL、API Key 和 Model。');
  }

  const baseUrl = settings.apiUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;

  const body: Record<string, unknown> = {
    model: settings.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream,
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
    throw new Error(`API 错误 (${response.status}): ${errorText || response.statusText}`);
  }

  return response;
}

export function registerChatHandlers(): void {
  // Non-streaming fallback (kept for compatibility)
  ipcMain.handle('chat:complete', async (_event, messages: ChatMessagePayload[]) => {
    const response = await callOpenAiCompatibleApi(messages, false);
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (data.error?.message) {
      throw new Error(`API 错误: ${data.error.message}`);
    }
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error('API 返回为空。');
    }
    return content;
  });

  // Streaming: renderer sends messages, main pushes chunks back
  ipcMain.on('chat:streamStart', async (event, messages: ChatMessagePayload[]) => {
    const send = (chunk: StreamChunkPayload) => {
      try { event.sender.send('chat:streamChunk', chunk); } catch { /* window closed */ }
    };

    try {
      const response = await callOpenAiCompatibleApi(messages, true);
      const reader = response.body?.getReader();
      if (!reader) {
        send({ type: 'error', text: '无法获取响应流' });
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') {
            if (trimmed === 'data: [DONE]') {
              send({ type: 'done', text: '' });
            }
            continue;
          }
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const json = JSON.parse(trimmed.slice(6));
            const delta = json.choices?.[0]?.delta;
            if (delta?.reasoning_content) {
              send({ type: 'thinking', text: delta.reasoning_content });
            } else if (delta?.content) {
              send({ type: 'content', text: delta.content });
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      // Handle remaining buffer
      if (buffer.trim() && buffer.trim() !== 'data: [DONE]') {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data: ')) {
          try {
            const json = JSON.parse(trimmed.slice(6));
            const delta = json.choices?.[0]?.delta;
            if (delta?.reasoning_content) {
              send({ type: 'thinking', text: delta.reasoning_content });
            } else if (delta?.content) {
              send({ type: 'content', text: delta.content });
            }
          } catch { /* ignore */ }
        }
      }

      send({ type: 'done', text: '' });
    } catch (err) {
      send({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
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
        return { ok: false, message: '请填写 API URL、API Key 和 Model。' };
      }
      await callOpenAiCompatibleApi(
        [{ role: 'user', content: 'Hi' }],
        false,
      );
      return { ok: true, message: '模型正常' };
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

  ipcMain.handle('aiSettings:getModels', async () => {
    const settings = aiSettings.getAiSettings();
    if (!settings.apiUrl || !settings.apiKey) {
      return { ok: false, models: [], error: '请先填写 API URL 和 API Key' };
    }
    try {
      const baseUrl = settings.apiUrl.replace(/\/+$/, '');
      const response = await fetch(`${baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
        },
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return { ok: false, models: [], error: `HTTP ${response.status}: ${text || response.statusText}` };
      }
      const data = (await response.json()) as {
        data?: Array<{ id: string; owned_by?: string; object?: string }>;
      };
      const models = (data.data ?? []).map((m) => ({
        id: m.id,
        owned_by: m.owned_by ?? '',
      }));
      return { ok: true, models };
    } catch (err) {
      return { ok: false, models: [], error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('aiSettings:getPresets', async () => {
    return aiSettings.AI_MODEL_PRESETS;
  });
}
