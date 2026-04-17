// OpenAI-compatible streaming provider with tool_calls support.
//
// The agent loop in loop.ts is provider-agnostic: it speaks in normalized
// `Message` and `StreamEvent` shapes (see types.ts). This module is the only
// place that knows about wire formats. Swap this file to target a different
// provider (Anthropic native, Google, etc.) and the rest of the agent works
// unchanged.
//
// Stream assembly notes:
//   - `delta.content`           → text_delta
//   - `delta.reasoning_content` → thinking_delta (DeepSeek R1, Claude reasoning)
//   - `delta.tool_calls[i]`     → tool_use_input_delta (partial JSON)
//                                 assembled by index, emitted complete on finish

import type {
  AssistantMessage,
  ContentBlock,
  JsonSchema,
  Message,
  ProviderConfig,
  StreamEvent,
  ToolDefinition,
  ToolUseBlock,
} from './types';

// Wire-format types. We only declare what we read; extras from the API are ignored.
interface WireToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: { name?: string; arguments?: string };
}

interface WireStreamChunk {
  choices?: Array<{
    index?: number;
    delta?: {
      role?: string;
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: WireToolCallDelta[];
    };
    finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
  error?: { message?: string };
}

// Build-up buffers for a single tool_call across stream chunks.
interface PendingToolCall {
  id: string;
  name: string;
  argsJson: string; // accumulates partial JSON text
}

// Convert our internal Message[] to the OpenAI wire format.
// Anthropic-style tool_result blocks become OpenAI role='tool' messages.
function serializeMessages(messages: Message[]): unknown[] {
  const out: unknown[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      out.push({ role: 'system', content: msg.content });
      continue;
    }
    if (msg.role === 'assistant') {
      const text = msg.content
        .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const toolUses = msg.content.filter(
        (b): b is ToolUseBlock => b.type === 'tool_use',
      );
      const entry: Record<string, unknown> = { role: 'assistant', content: text || null };
      if (toolUses.length > 0) {
        entry.tool_calls = toolUses.map((tu) => ({
          id: tu.id,
          type: 'function',
          function: { name: tu.name, arguments: JSON.stringify(tu.input) },
        }));
      }
      out.push(entry);
      continue;
    }
    // user role
    if (typeof msg.content === 'string') {
      out.push({ role: 'user', content: msg.content });
      continue;
    }
    // Content blocks from the user side: split tool_result blocks into separate
    // role='tool' messages, and collapse text blocks into one role='user' message.
    const textParts: string[] = [];
    for (const block of msg.content) {
      if (block.type === 'tool_result') {
        out.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content: block.content,
        });
      } else if (block.type === 'text') {
        textParts.push(block.text);
      }
    }
    if (textParts.length > 0) {
      out.push({ role: 'user', content: textParts.join('\n') });
    }
  }
  return out;
}

function serializeTools(tools: ToolDefinition[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters as unknown as JsonSchema,
    },
  }));
}

// Some providers ignore `tools: []`; send undefined in that case.
function buildRequestBody(
  config: ProviderConfig,
  messages: Message[],
  tools: ToolDefinition[],
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages: serializeMessages(messages),
    stream: true,
  };
  if (tools.length > 0) body.tools = serializeTools(tools);
  if (typeof config.temperature === 'number') body.temperature = config.temperature;
  if (typeof config.maxTokens === 'number') body.max_tokens = config.maxTokens;
  if (config.thinking && config.thinking.mode === 'enabled') {
    // Anthropic-style extended thinking; providers that don't support it ignore.
    body.thinking = {
      type: 'enabled',
      budget_tokens: config.thinking.budgetTokens ?? 4000,
    };
  }
  return body;
}

// Minimal SSE parser that yields `data: ...` payloads one at a time.
async function* parseSSE(
  response: Response,
  signal: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Response has no body');
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by blank lines; each event has one or more
      // `data: ...` lines. We ignore comment lines (starting with ':').
      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (line.startsWith('data:')) {
          yield line.slice(5).trimStart();
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

// Stream an assistant turn. Yields StreamEvents as they arrive; the final
// return value is the assembled assistant Message.
export async function* streamCompletion(
  config: ProviderConfig,
  messages: Message[],
  tools: ToolDefinition[],
  signal: AbortSignal,
): AsyncGenerator<StreamEvent, AssistantMessage, unknown> {
  const body = buildRequestBody(config, messages, tools);
  const response = await fetch(config.apiUrl.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`API error ${response.status}: ${errText || response.statusText}`);
  }

  const assembledText: string[] = [];
  const pendingToolCalls = new Map<number, PendingToolCall>();
  const completedToolUses: ToolUseBlock[] = [];
  let thinkingStart: number | null = null;
  let sawThinkingDelta = false;

  for await (const payload of parseSSE(response, signal)) {
    if (payload === '[DONE]') break;
    let chunk: WireStreamChunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue; // tolerate non-JSON lines (comments, heartbeats)
    }
    if (chunk.error) {
      yield { type: 'error', message: chunk.error.message ?? 'Unknown API error', recoverable: false };
      continue;
    }
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta ?? {};

    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
      if (thinkingStart == null) thinkingStart = Date.now();
      sawThinkingDelta = true;
      yield { type: 'thinking_delta', text: delta.reasoning_content };
    }
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      if (sawThinkingDelta && thinkingStart != null) {
        yield { type: 'thinking_end', durationMs: Date.now() - thinkingStart };
        sawThinkingDelta = false;
      }
      assembledText.push(delta.content);
      yield { type: 'text_delta', text: delta.content };
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        let pending = pendingToolCalls.get(tc.index);
        if (!pending) {
          pending = { id: tc.id ?? '', name: tc.function?.name ?? '', argsJson: '' };
          pendingToolCalls.set(tc.index, pending);
          if (pending.id && pending.name) {
            yield { type: 'tool_use_start', id: pending.id, name: pending.name };
          }
        } else {
          if (tc.id && !pending.id) pending.id = tc.id;
          if (tc.function?.name && !pending.name) pending.name = tc.function.name;
          if (pending.id && pending.name && pending.argsJson === '') {
            yield { type: 'tool_use_start', id: pending.id, name: pending.name };
          }
        }
        if (tc.function?.arguments) {
          pending.argsJson += tc.function.arguments;
          if (pending.id) {
            yield {
              type: 'tool_use_input_delta',
              id: pending.id,
              partialJson: tc.function.arguments,
            };
          }
        }
      }
    }

    if (choice.finish_reason) {
      // Finalize any pending tool_calls.
      for (const pending of pendingToolCalls.values()) {
        let input: Record<string, unknown> = {};
        if (pending.argsJson) {
          try {
            input = JSON.parse(pending.argsJson);
          } catch {
            // Model emitted malformed JSON; pass as raw string under a sentinel key
            // so the tool can surface the error as a tool_result.
            input = { __invalid_json__: pending.argsJson };
          }
        }
        const block: ToolUseBlock = {
          type: 'tool_use',
          id: pending.id || `call_${Date.now()}_${completedToolUses.length}`,
          name: pending.name,
          input,
        };
        completedToolUses.push(block);
        yield { type: 'tool_use_complete', block };
      }
      pendingToolCalls.clear();
      if (sawThinkingDelta && thinkingStart != null) {
        yield { type: 'thinking_end', durationMs: Date.now() - thinkingStart };
        sawThinkingDelta = false;
      }
      break;
    }
  }

  // Assemble the final assistant message: text first, then tool_use blocks.
  const blocks: ContentBlock[] = [];
  const joinedText = assembledText.join('');
  if (joinedText.length > 0) blocks.push({ type: 'text', text: joinedText });
  for (const tu of completedToolUses) blocks.push(tu);
  return { role: 'assistant', content: blocks };
}
