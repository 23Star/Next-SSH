// useAgent — drive the agent loop and expose a render-friendly transcript.
//
// The agent yields StreamEvents; this hook reduces them into a flat list of
// ConversationItems that the drawer walks in order. Text and thinking blocks
// append to their current "chunk"; tool uses live as cards whose status
// progresses pending → awaiting_permission → running → done/error.
//
// Permission prompts: the agent loop calls `config.requestPermission` as a
// promise. We stash the pending request in state, render the dialog, and
// resolve it when the user clicks allow/deny.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  runAgent,
  buildSystemPrompt,
  DEFAULT_TOOLS,
} from '../../agent';
import type {
  ContentBlock,
  ExecutionTarget,
  Message,
  PermissionRequest,
  PermissionResponse,
  ProviderConfig,
  StreamEvent,
  ToolResultBlock,
  ToolUseBlock,
} from '../../agent/types';
import type { SystemSnapshot } from '../../agent/tools/SystemInfo';
import { loadAIConfig } from './aiConfig';

export type AgentStatus = 'idle' | 'running' | 'awaiting_permission' | 'error';

export interface UserItem {
  kind: 'user';
  id: string;
  text: string;
}

export interface AssistantTextItem {
  kind: 'assistant_text';
  id: string;
  text: string;
  streaming: boolean;
}

export interface ThinkingItem {
  kind: 'thinking';
  id: string;
  text: string;
  durationMs: number | null;
  streaming: boolean;
}

export interface ToolUseItem {
  kind: 'tool_use';
  id: string;          // tool_use id from the model
  name: string;
  input: Record<string, unknown>;
  status: 'pending' | 'awaiting_permission' | 'running' | 'done' | 'error' | 'denied';
  result: string | null;
  isError: boolean;
  partialArgs: string; // raw JSON text as it streams in
}

export interface SystemItem {
  kind: 'system';
  id: string;
  text: string;
  tone: 'info' | 'warn' | 'error';
}

export type ConversationItem =
  | UserItem
  | AssistantTextItem
  | ThinkingItem
  | ToolUseItem
  | SystemItem;

export interface PendingPermission {
  id: string;
  toolName: string;
  description: string;
  input: Record<string, unknown>;
  decide: (response: PermissionResponse) => void;
}

export interface UseAgentOptions {
  target: ExecutionTarget | null;
  hostLabel: string | null;
  snapshot: SystemSnapshot | null;
}

export interface UseAgentState {
  items: ConversationItem[];
  status: AgentStatus;
  pendingPermission: PendingPermission | null;
  configError: string | null;
  send: (text: string) => Promise<void>;
  stop: () => void;
  reset: () => void;
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

export function useAgent({ target, hostLabel, snapshot }: UseAgentOptions): UseAgentState {
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  // Persistent conversation history for follow-up turns.
  const historyRef = useRef<Message[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus('idle');
  }, []);

  const reset = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    historyRef.current = [];
    setItems([]);
    setStatus('idle');
    setPendingPermission(null);
    setConfigError(null);
  }, []);

  // Clean up on unmount — abort any in-flight run.
  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  // Reset conversation when the target host changes; the agent shouldn't
  // carry knowledge from one host into another.
  const targetKey = target?.kind === 'remote' ? `remote:${target.connectionId}` : target ? 'local' : 'none';
  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  const send = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (status === 'running' || status === 'awaiting_permission') return;
      if (!target) {
        setItems((prev) => [
          ...prev,
          { kind: 'system', id: genId('sys'), text: 'Select a host first — the assistant needs a target.', tone: 'warn' },
        ]);
        return;
      }

      setConfigError(null);
      const aiConfig = await loadAIConfig();
      if (!aiConfig.configured || !aiConfig.provider) {
        setConfigError('AI provider not configured. Open Settings and fill in API URL, key, and model.');
        setItems((prev) => [
          ...prev,
          {
            kind: 'system',
            id: genId('sys'),
            text: 'AI provider not configured — configure it in Settings to chat.',
            tone: 'error',
          },
        ]);
        return;
      }

      // Push the user bubble immediately.
      const userItem: UserItem = { kind: 'user', id: genId('u'), text: trimmed };
      setItems((prev) => [...prev, userItem]);
      historyRef.current.push({ role: 'user', content: trimmed });

      const controller = new AbortController();
      abortRef.current = controller;
      setStatus('running');

      const systemPrompt = buildSystemPrompt({
        hostLabel,
        os: snapshot?.os ?? null,
        kernel: snapshot?.kernel ?? null,
        username: null,
        isRoot: false,
        currentDate: new Date().toISOString().slice(0, 10),
      });

      // Per-turn state: track the "current" text/thinking chunk ids so deltas
      // append instead of creating a new item per SSE frame.
      let currentAssistantTextId: string | null = null;
      let currentThinkingId: string | null = null;

      const requestPermission: PermissionRequest = (req) =>
        new Promise<PermissionResponse>((resolve) => {
          setStatus('awaiting_permission');
          setItems((prev) =>
            prev.map((it) =>
              it.kind === 'tool_use' && it.id === req.toolName + '::__unused'
                ? it
                : it,
            ),
          );
          // Mark the matching tool-use card as awaiting permission.
          setItems((prev) =>
            prev.map((it) =>
              it.kind === 'tool_use' && it.status === 'pending' && it.name === req.toolName
                ? { ...it, status: 'awaiting_permission' }
                : it,
            ),
          );
          setPendingPermission({
            id: genId('perm'),
            toolName: req.toolName,
            description: req.description,
            input: req.input,
            decide: (response) => {
              setPendingPermission(null);
              setStatus('running');
              resolve(response);
            },
          });
          req.signal.addEventListener(
            'abort',
            () => {
              setPendingPermission(null);
              resolve({ decision: 'deny' });
            },
            { once: true },
          );
        });

      const cfg = {
        provider: aiConfig.provider as ProviderConfig,
        systemPrompt,
        tools: DEFAULT_TOOLS,
        target,
        requestPermission,
      };

      try {
        const generator = runAgent(historyRef.current, cfg, controller.signal);
        while (true) {
          const { value, done } = await generator.next();
          if (done) {
            // value is AgentRunResult — persist the final history for follow-ups.
            historyRef.current = value.messages.filter((m) => m.role !== 'system');
            if (value.reason === 'max_turns') {
              setItems((prev) => [
                ...prev,
                { kind: 'system', id: genId('sys'), text: 'Hit the turn cap. Ask me to continue if you want more.', tone: 'warn' },
              ]);
            }
            break;
          }
          applyEvent(value, {
            setItems,
            getAssistantTextId: () => currentAssistantTextId,
            setAssistantTextId: (id) => { currentAssistantTextId = id; },
            getThinkingId: () => currentThinkingId,
            setThinkingId: (id) => { currentThinkingId = id; },
          });
        }
        setStatus('idle');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (controller.signal.aborted) {
          setItems((prev) => [
            ...prev,
            { kind: 'system', id: genId('sys'), text: 'Stopped.', tone: 'info' },
          ]);
        } else {
          setItems((prev) => [
            ...prev,
            { kind: 'system', id: genId('sys'), text: `Error: ${message}`, tone: 'error' },
          ]);
        }
        setStatus('error');
      } finally {
        abortRef.current = null;
      }
    },
    [target, hostLabel, snapshot, status],
  );

  return useMemo(
    () => ({ items, status, pendingPermission, configError, send, stop, reset }),
    [items, status, pendingPermission, configError, send, stop, reset],
  );
}

interface ApplyCtx {
  setItems: React.Dispatch<React.SetStateAction<ConversationItem[]>>;
  getAssistantTextId: () => string | null;
  setAssistantTextId: (id: string | null) => void;
  getThinkingId: () => string | null;
  setThinkingId: (id: string | null) => void;
}

function applyEvent(event: StreamEvent, ctx: ApplyCtx): void {
  switch (event.type) {
    case 'turn_start':
      // Reset per-turn chunk refs so the next assistant text/thinking starts fresh.
      ctx.setAssistantTextId(null);
      ctx.setThinkingId(null);
      return;

    case 'text_delta': {
      let id = ctx.getAssistantTextId();
      if (!id) {
        id = genId('a');
        ctx.setAssistantTextId(id);
        const newId = id;
        ctx.setItems((prev) => [
          ...prev,
          { kind: 'assistant_text', id: newId, text: event.text, streaming: true },
        ]);
      } else {
        const knownId = id;
        ctx.setItems((prev) =>
          prev.map((it) =>
            it.kind === 'assistant_text' && it.id === knownId
              ? { ...it, text: it.text + event.text }
              : it,
          ),
        );
      }
      return;
    }

    case 'thinking_delta': {
      let id = ctx.getThinkingId();
      if (!id) {
        id = genId('t');
        ctx.setThinkingId(id);
        const newId = id;
        ctx.setItems((prev) => [
          ...prev,
          { kind: 'thinking', id: newId, text: event.text, durationMs: null, streaming: true },
        ]);
      } else {
        const knownId = id;
        ctx.setItems((prev) =>
          prev.map((it) =>
            it.kind === 'thinking' && it.id === knownId
              ? { ...it, text: it.text + event.text }
              : it,
          ),
        );
      }
      return;
    }

    case 'thinking_end': {
      const id = ctx.getThinkingId();
      if (!id) return;
      ctx.setItems((prev) =>
        prev.map((it) =>
          it.kind === 'thinking' && it.id === id
            ? { ...it, streaming: false, durationMs: event.durationMs }
            : it,
        ),
      );
      return;
    }

    case 'tool_use_start': {
      const id = event.id;
      ctx.setItems((prev) => {
        // Guard against duplicate start events — provider emits one as soon as
        // the id+name are both known; subsequent deltas shouldn't re-add.
        if (prev.some((it) => it.kind === 'tool_use' && it.id === id)) return prev;
        const item: ToolUseItem = {
          kind: 'tool_use',
          id,
          name: event.name,
          input: {},
          status: 'pending',
          result: null,
          isError: false,
          partialArgs: '',
        };
        return [...prev, item];
      });
      // New tool call closes out any in-flight text/thinking chunks.
      ctx.setAssistantTextId(null);
      ctx.setThinkingId(null);
      return;
    }

    case 'tool_use_input_delta': {
      const id = event.id;
      ctx.setItems((prev) =>
        prev.map((it) =>
          it.kind === 'tool_use' && it.id === id
            ? { ...it, partialArgs: it.partialArgs + event.partialJson }
            : it,
        ),
      );
      return;
    }

    case 'tool_use_complete': {
      const block: ToolUseBlock = event.block;
      ctx.setItems((prev) =>
        prev.map((it) =>
          it.kind === 'tool_use' && it.id === block.id
            ? { ...it, input: block.input, status: 'running' as const }
            : it,
        ),
      );
      return;
    }

    case 'tool_result': {
      const block: ToolResultBlock = event.block;
      ctx.setItems((prev) =>
        prev.map((it) => {
          if (it.kind !== 'tool_use' || it.id !== block.tool_use_id) return it;
          const deniedMatch = block.content.includes('User denied permission');
          return {
            ...it,
            status: deniedMatch ? 'denied' : block.isError ? 'error' : 'done',
            result: block.content,
            isError: Boolean(block.isError),
          };
        }),
      );
      return;
    }

    case 'assistant_message': {
      // We already rendered via deltas — nothing to do. The message is already
      // in ctx's transcript via history.
      const msg = event.message;
      if (msg.role === 'assistant') {
        const hasText = msg.content.some((b: ContentBlock) => b.type === 'text');
        // If the stream only emitted finish_reason without any text deltas
        // (rare), fall back to rendering the final text here.
        if (hasText && ctx.getAssistantTextId() == null) {
          const text = msg.content
            .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
            .map((b) => b.text)
            .join('');
          if (text) {
            const id = genId('a');
            ctx.setItems((prev) => [
              ...prev,
              { kind: 'assistant_text', id, text, streaming: false },
            ]);
          }
        } else {
          // Mark current streaming text chunk as settled.
          const curId = ctx.getAssistantTextId();
          if (curId) {
            ctx.setItems((prev) =>
              prev.map((it) =>
                it.kind === 'assistant_text' && it.id === curId
                  ? { ...it, streaming: false }
                  : it,
              ),
            );
          }
        }
      }
      return;
    }

    case 'error': {
      ctx.setItems((prev) => [
        ...prev,
        { kind: 'system', id: genId('sys'), text: event.message, tone: 'error' },
      ]);
      return;
    }

    case 'done':
      return;
  }
}
