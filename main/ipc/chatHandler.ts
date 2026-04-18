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
  type: 'content' | 'thinking' | 'thinking_end' | 'done' | 'error';
  text: string;
  durationMs?: number;
}

// ── Thinking Configuration (inspired by Claude Code) ──────────────
export type ThinkingMode = 'adaptive' | 'enabled' | 'disabled';

export interface ThinkingConfig {
  mode: ThinkingMode;
  /** Only used when mode === 'enabled' */
  budgetTokens?: number;
}

// ── Model Capability Detection ────────────────────────────────────

/** Patterns for models known to support reasoning/thinking output. */
const THINKING_CAPABLE_PATTERNS = [
  /\bo[1-4]\b/i,
  /\bo1-/i,
  /deepseek-r/i,
  /deepseek-reasoner/i,
  /deepseek.*think/i,
  /qwq/i,
  /qwen3/i,
  /qwen.*think/i,
  /glm-z1/i,
  /glm.*think/i,
  /claude-.*3[.-]5/i,
  /claude-.*4/i,
  /claude-opus/i,
  /claude-sonnet/i,
  /gemini.*thinking/i,
  /gemini.*flash.*thinking/i,
  /grok.*think/i,
];

/** Check if a model name is known to support thinking/reasoning. */
function modelSupportsThinking(model: string): boolean {
  if (!model) return false;
  return THINKING_CAPABLE_PATTERNS.some((p) => p.test(model));
}

/** Patterns for models known to support adaptive (budget-less) thinking. */
const ADAPTIVE_THINKING_PATTERNS = [
  /deepseek-r/i,
  /deepseek-reasoner/i,
  /qwq/i,
  /qwen3/i,
  /glm-z1/i,
  /claude-.*4/i,
  /claude-opus/i,
  /claude-sonnet/i,
];

function modelSupportsAdaptiveThinking(model: string): boolean {
  if (!model) return false;
  return ADAPTIVE_THINKING_PATTERNS.some((p) => p.test(model));
}

// ── Auto max_tokens per model ─────────────────────────────────────

/** Default max_tokens for known model families. */
const MODEL_MAX_TOKENS: Array<{ pattern: RegExp; tokens: number }> = [
  { pattern: /gpt-4o/i, tokens: 16384 },
  { pattern: /gpt-4\.?1/i, tokens: 32768 },
  { pattern: /gpt-4/i, tokens: 8192 },
  { pattern: /o[1-4]/i, tokens: 32768 },
  { pattern: /deepseek-chat/i, tokens: 8192 },
  { pattern: /deepseek-reasoner/i, tokens: 8192 },
  { pattern: /deepseek-r/i, tokens: 8192 },
  { pattern: /qwen.*turbo/i, tokens: 8192 },
  { pattern: /qwen.*plus/i, tokens: 8192 },
  { pattern: /qwen.*max/i, tokens: 32768 },
  { pattern: /qwq/i, tokens: 32768 },
  { pattern: /qwen3/i, tokens: 32768 },
  { pattern: /glm-5/i, tokens: 8192 },
  { pattern: /glm-4/i, tokens: 8192 },
  { pattern: /glm-z1/i, tokens: 8192 },
  { pattern: /claude/i, tokens: 8192 },
  { pattern: /gemini/i, tokens: 8192 },
  { pattern: /llama/i, tokens: 4096 },
  { pattern: /mistral/i, tokens: 8192 },
];

function getAutoMaxTokens(model: string, userSetting: number): number {
  // If user explicitly set a non-default value, respect it
  if (userSetting > 0 && userSetting !== 4096) return userSetting;
  // Auto-detect from model name
  for (const entry of MODEL_MAX_TOKENS) {
    if (entry.pattern.test(model)) return entry.tokens;
  }
  return userSetting > 0 ? userSetting : 4096;
}

// ── Temperature auto-adjustment ───────────────────────────────────

/** Some models require temperature=1 when thinking is enabled. */
function shouldForceTemperatureOne(model: string, thinkingEnabled: boolean): boolean {
  if (!thinkingEnabled) return false;
  // DeepSeek reasoner requires temperature=1 for thinking
  if (/deepseek-reasoner/i.test(model)) return true;
  if (/deepseek-r/i.test(model)) return true;
  // Claude models with thinking
  if (/claude/i.test(model)) return true;
  return false;
}

// ── Core API call ─────────────────────────────────────────────────

async function callOpenAiCompatibleApi(
  messages: ChatMessagePayload[],
  stream: boolean = false,
  thinkingConfig: ThinkingConfig = { mode: 'adaptive' },
): Promise<Response> {
  const settings = aiSettings.getAiSettings();
  if (!settings.apiUrl || !settings.apiKey || !settings.model) {
    throw new Error('AI 未配置。请在设置中配置 API URL、API Key 和 Model。');
  }

  const baseUrl = settings.apiUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;

  const modelSupportsThink = modelSupportsThinking(settings.model);
  const shouldEnableThinking = thinkingConfig.mode !== 'disabled' && modelSupportsThink;

  const maxTokens = getAutoMaxTokens(settings.model, settings.maxTokens);

  const body: Record<string, unknown> = {
    model: settings.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream,
  };

  // ── Thinking parameters (multi-format for broad compatibility) ──
  if (shouldEnableThinking) {
    if (modelSupportsAdaptiveThinking(settings.model) && thinkingConfig.mode === 'adaptive') {
      // Adaptive thinking: let model decide budget
      body.thinking = { type: 'enabled' };
      body.enable_thinking = true;
    } else if (thinkingConfig.mode === 'enabled' && thinkingConfig.budgetTokens) {
      // Explicit budget
      const budget = Math.min(thinkingConfig.budgetTokens, maxTokens - 1);
      body.thinking = { type: 'enabled', budget_tokens: budget };
      body.enable_thinking = true;
    } else {
      // Basic thinking toggle
      body.enable_thinking = true;
    }
    // vLLM / self-hosted format
    body.chat_template_kwargs = { thinking: true };
  }

  // ── Temperature ──
  if (shouldForceTemperatureOne(settings.model, shouldEnableThinking)) {
    // Don't set temperature — let the API use its default (1)
    // Some providers error if temperature != 1 with thinking
  } else if (settings.temperature > 0) {
    body.temperature = settings.temperature;
  }

  // ── Max tokens ──
  if (maxTokens > 0) {
    body.max_tokens = maxTokens;
  }

  // Timeout: abort the request if the server doesn't respond within 120 seconds
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('API 请求超时 (120s)。请检查网络连接或 API 地址。');
    }
    throw err;
  }

  if (!response.ok) {
    clearTimeout(timeoutId);
    const errorText = await response.text().catch(() => '');
    throw new Error(`API 错误 (${response.status}): ${errorText || response.statusText}`);
  }

  // Clear timeout on successful response — the body stream is read separately
  // with its own timeout in the streaming handler
  clearTimeout(timeoutId);

  return response;
}

export function registerChatHandlers(): void {
  // Non-streaming: returns { v: string } to avoid ByteString issues
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
    return { v: content };
  });

  // Streaming: receives raw array (structured clone handles Unicode in objects)
  ipcMain.handle('chat:streamStart', async (event, messages: ChatMessagePayload[], thinkingConfigOrEnable?: ThinkingConfig | boolean) => {
    const send = (chunk: StreamChunkPayload) => {
      try { event.sender.send('chat:streamChunk', chunk); } catch { /* window closed */ }
    };

    // Resolve thinking config from either new ThinkingConfig or legacy boolean
    let resolvedConfig: ThinkingConfig;
    if (typeof thinkingConfigOrEnable === 'boolean') {
      resolvedConfig = thinkingConfigOrEnable ? { mode: 'adaptive' } : { mode: 'disabled' };
    } else if (thinkingConfigOrEnable && typeof thinkingConfigOrEnable === 'object' && 'mode' in thinkingConfigOrEnable) {
      resolvedConfig = thinkingConfigOrEnable as ThinkingConfig;
    } else {
      resolvedConfig = { mode: 'adaptive' };
    }

    try {
      const response = await callOpenAiCompatibleApi(messages, true, resolvedConfig);
      const reader = response.body?.getReader();
      if (!reader) {
        send({ type: 'error', text: '无法获取响应流' });
        send({ type: 'done', text: '' });
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let thinkingStartTime: number | null = null;

      // Stream idle timeout: if no data arrives for 90 seconds, abort
      let streamTimeoutId: ReturnType<typeof setTimeout> | null = null;
      let streamDone = false;
      const resetStreamTimeout = () => {
        if (streamTimeoutId) clearTimeout(streamTimeoutId);
        streamTimeoutId = setTimeout(() => {
          if (streamDone) return;
          streamDone = true;
          reader.cancel().catch(() => {});
          send({ type: 'error', text: 'AI 响应超时 (90s 无数据)，请重试。' });
          send({ type: 'done', text: '' });
        }, 90_000);
      };
      resetStreamTimeout();

      try {
      while (true) {
        const { done, value } = await reader.read();
        resetStreamTimeout();
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
              if (thinkingStartTime === null) thinkingStartTime = Date.now();
              send({ type: 'thinking', text: delta.reasoning_content });
            } else if (delta?.content) {
              if (thinkingStartTime !== null) {
                send({ type: 'thinking_end', text: '', durationMs: Date.now() - thinkingStartTime });
                thinkingStartTime = null;
              }
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
              if (thinkingStartTime === null) thinkingStartTime = Date.now();
              send({ type: 'thinking', text: delta.reasoning_content });
            } else if (delta?.content) {
              if (thinkingStartTime !== null) {
                send({ type: 'thinking_end', text: '', durationMs: Date.now() - thinkingStartTime });
                thinkingStartTime = null;
              }
              send({ type: 'content', text: delta.content });
            }
          } catch { /* ignore */ }
        }
      }

      if (streamTimeoutId) clearTimeout(streamTimeoutId);
      if (!streamDone) { streamDone = true; send({ type: 'done', text: '' }); }
      } catch (err) {
        if (streamTimeoutId) clearTimeout(streamTimeoutId);
        if (!streamDone) {
          streamDone = true;
          send({ type: 'error', text: err instanceof Error ? err.message : String(err) });
          send({ type: 'done', text: '' });
        }
      }
    } catch (err) {
      send({ type: 'error', text: err instanceof Error ? err.message : String(err) });
      send({ type: 'done', text: '' });
    }
  });

  ipcMain.handle('chatSession:list', async () => chatSessionRepo.listChatSessions());
  ipcMain.handle('chatSession:create', async (_event, titleObj: { v: string } | null) =>
    chatSessionRepo.createChatSession(titleObj?.v ?? null),
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
    async (_event, sessionId: number, role: string, contentObj: { v: string }, suggestedCommands?: string[] | null, thinkingObj?: { v: string } | null, thinkingDurationMs?: number | null) =>
      chatContextRepo.addChatContext(sessionId, role, contentObj.v, suggestedCommands, thinkingObj?.v ?? null, thinkingDurationMs ?? null),
  );
  ipcMain.handle('chatContext:deleteByIds', async (_event, ids: number[]) =>
    chatContextRepo.deleteChatContextByIds(ids),
  );

  ipcMain.handle('serveroutput:get', async (_event, connectionId: number) => {
    return serveroutputContextRepo.getServeroutputContextByConnectionId(connectionId);
  });
  ipcMain.handle('serveroutput:append', async (_event, connectionId: number, dataObj: { v: string }) => {
    serveroutputContextRepo.appendServeroutputContextByConnectionId(connectionId, dataObj.v);
  });
}

export function registerAiSettingsHandlers(): void {
  ipcMain.handle('aiSettings:get', async () => {
    return aiSettings.getAiSettingsDisplay();
  });

  // Returns the unmasked AI settings to the renderer. v2's agent runs in the
  // renderer (tool IPC lives there) and needs the raw key to call the API.
  ipcMain.handle('aiSettings:getRaw', async () => {
    return aiSettings.getAiSettings();
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
        { mode: 'disabled' },
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
