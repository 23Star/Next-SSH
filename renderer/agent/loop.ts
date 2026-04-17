// The agent loop.
//
// Modeled after Claude Code's `queryLoop()`:
//
//   while (turn < maxTurns) {
//     turn++
//     stream assistant response (yield deltas)
//     append assistant message
//     if no tool_use blocks: done (completed)
//     for each tool_use: check permission → execute → collect result
//     append user message carrying all tool_result blocks
//   }
//
// The loop is an async generator: it yields `StreamEvent`s for the UI to
// render and returns the final message history when the conversation settles.
// Callers drive it with `for await`.
//
// Concurrency: tools whose `isConcurrencySafe(input)` returns true run in
// parallel via Promise.all. Non-safe tools run sequentially, in the order the
// model emitted them.

import { checkToolPermission, PermissionStore } from './permissions';
import { streamCompletion } from './provider';
import type {
  AgentConfig,
  AssistantMessage,
  ContentBlock,
  Message,
  StreamEvent,
  ToolDefinition,
  ToolResultBlock,
  ToolUseBlock,
} from './types';

const DEFAULT_MAX_TURNS = 30;

function hostKeyFor(config: AgentConfig): string | null {
  if (config.target.kind === 'remote') return `conn:${config.target.connectionId}`;
  return 'local';
}

async function executeOneTool(
  toolUse: ToolUseBlock,
  tools: ToolDefinition[],
  config: AgentConfig,
  store: PermissionStore,
  signal: AbortSignal,
): Promise<ToolResultBlock> {
  const tool = tools.find((t) => t.name === toolUse.name);
  if (!tool) {
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: `Error: unknown tool "${toolUse.name}". Available: ${tools.map((t) => t.name).join(', ')}`,
      isError: true,
    };
  }

  // Invalid JSON sentinel from provider.ts — surface immediately.
  if (typeof toolUse.input === 'object' && toolUse.input !== null && '__invalid_json__' in toolUse.input) {
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: `Error: tool arguments were not valid JSON. Raw: ${String(
        (toolUse.input as Record<string, unknown>).__invalid_json__,
      )}`,
      isError: true,
    };
  }

  const permission = await checkToolPermission({
    tool,
    toolUse,
    store,
    hostKey: hostKeyFor(config),
    requestPermission: config.requestPermission,
    signal,
  });
  if (permission.decision === 'deny') {
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: 'User denied permission to run this tool.',
      isError: true,
    };
  }

  try {
    const result = await tool.execute(toolUse.input, {
      target: config.target,
      signal,
    });
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: result.content,
      isError: result.isError,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: `Tool execution failed: ${message}`,
      isError: true,
    };
  }
}

// Group tool uses into batches that can run in parallel. Within a batch every
// tool is concurrency-safe; a non-safe tool always lives in its own batch and
// acts as a barrier so previous and subsequent tools observe its side effects.
function planExecution(
  toolUses: ToolUseBlock[],
  tools: ToolDefinition[],
): ToolUseBlock[][] {
  const batches: ToolUseBlock[][] = [];
  let current: ToolUseBlock[] = [];
  for (const tu of toolUses) {
    const tool = tools.find((t) => t.name === tu.name);
    const safe = tool ? tool.isConcurrencySafe(tu.input) : false;
    if (safe) {
      current.push(tu);
    } else {
      if (current.length > 0) {
        batches.push(current);
        current = [];
      }
      batches.push([tu]);
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export interface AgentRunResult {
  messages: Message[];
  reason: 'completed' | 'max_turns' | 'aborted' | 'error';
}

export async function* runAgent(
  initialMessages: Message[],
  config: AgentConfig,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent, AgentRunResult, unknown> {
  const maxTurns = config.maxTurns ?? DEFAULT_MAX_TURNS;
  const store = new PermissionStore();
  const messages: Message[] = [{ role: 'system', content: config.systemPrompt }, ...initialMessages];

  let turn = 0;
  while (turn < maxTurns) {
    if (signal.aborted) {
      yield { type: 'done', reason: 'aborted' };
      return { messages, reason: 'aborted' };
    }
    turn += 1;
    yield { type: 'turn_start', turn };

    // Stream the assistant response for this turn.
    let assistantMsg: AssistantMessage;
    try {
      const stream = streamCompletion(config.provider, messages, config.tools, signal);
      while (true) {
        const { value, done } = await stream.next();
        if (done) {
          assistantMsg = value;
          break;
        }
        yield value;
      }
    } catch (err) {
      if (signal.aborted) {
        yield { type: 'done', reason: 'aborted' };
        return { messages, reason: 'aborted' };
      }
      const message = err instanceof Error ? err.message : String(err);
      yield { type: 'error', message, recoverable: false };
      yield { type: 'done', reason: 'error' };
      return { messages, reason: 'error' };
    }

    messages.push(assistantMsg);
    yield { type: 'assistant_message', message: assistantMsg };

    const toolUses = assistantMsg.content.filter(
      (b): b is ToolUseBlock => b.type === 'tool_use',
    );
    if (toolUses.length === 0) {
      config.onTurnEnd?.(messages);
      yield { type: 'done', reason: 'completed' };
      return { messages, reason: 'completed' };
    }

    // Execute tools, batched by concurrency-safety.
    const batches = planExecution(toolUses, config.tools);
    const resultBlocks: ToolResultBlock[] = [];
    for (const batch of batches) {
      if (signal.aborted) {
        yield { type: 'done', reason: 'aborted' };
        return { messages, reason: 'aborted' };
      }
      const results = await Promise.all(
        batch.map((tu) => executeOneTool(tu, config.tools, config, store, signal)),
      );
      for (const r of results) {
        resultBlocks.push(r);
        yield { type: 'tool_result', block: r };
      }
    }

    // Push the tool_result blocks as a single user message so the next turn
    // sees all of them together (in the order the model requested).
    const userContent: ContentBlock[] = resultBlocks;
    messages.push({ role: 'user', content: userContent });
    config.onTurnEnd?.(messages);
  }

  yield { type: 'done', reason: 'max_turns' };
  return { messages, reason: 'max_turns' };
}
