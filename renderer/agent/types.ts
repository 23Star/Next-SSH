// Core types for the Next-SSH agent.
//
// These shapes are modeled after Anthropic's content-block format because it's
// richer than OpenAI's wire format (tool_result is a first-class block instead
// of a separate role). The provider layer translates to whatever the remote API
// expects on the wire. Everything above the provider stays normalized here.

export type Role = 'system' | 'user' | 'assistant';

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  isError?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface SystemMessage {
  role: 'system';
  content: string;
}
export interface UserMessage {
  role: 'user';
  content: string | ContentBlock[];
}
export interface AssistantMessage {
  role: 'assistant';
  content: ContentBlock[];
}
export type Message = SystemMessage | UserMessage | AssistantMessage;

// A minimal JSON Schema subset we use for tool parameters. We don't enforce
// every JSON Schema feature — enough to describe tool arguments for the model.
export interface JsonSchema {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: Array<string | number | boolean>;
  default?: unknown;
  additionalProperties?: boolean | JsonSchema;
}

// Where a tool runs: a numeric connection id (remote SSH) or null (local shell).
export type ExecutionTarget = { kind: 'remote'; connectionId: number } | { kind: 'local' };

export interface ToolContext {
  target: ExecutionTarget;
  signal: AbortSignal;
  // Optional progress callback for long-running tools.
  onProgress?: (message: string) => void;
}

export interface ToolResult {
  // Human-readable content fed back to the model as tool_result.
  content: string;
  // Optional structured data for UI rendering (tables, charts, etc.).
  data?: unknown;
  isError?: boolean;
}

// Tools receive untyped `Record<string, unknown>` input because the arguments
// come from the model as JSON. Each tool narrows internally (see individual
// tool files). We deliberately don't use a generic here so the registry can
// hold heterogeneous tools without a widening cast at every call site.
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
  // Read-only tools are auto-approved; write tools go through the permission system.
  isReadOnly: (input: Record<string, unknown>) => boolean;
  // Concurrency-safe tools may run in parallel within a single turn.
  isConcurrencySafe: (input: Record<string, unknown>) => boolean;
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

// Stream events yielded by the agent loop. The UI layer consumes these.
export type StreamEvent =
  | { type: 'turn_start'; turn: number }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'thinking_end'; durationMs: number }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_input_delta'; id: string; partialJson: string }
  | { type: 'tool_use_complete'; block: ToolUseBlock }
  | { type: 'assistant_message'; message: Message }
  | { type: 'tool_result'; block: ToolResultBlock }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'done'; reason: 'completed' | 'max_turns' | 'aborted' | 'error' };

export interface ProviderConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  // Enable extended thinking when provider/model supports it. Providers ignore if unsupported.
  thinking?: { mode: 'adaptive' | 'enabled' | 'disabled'; budgetTokens?: number };
}

export interface AgentConfig {
  provider: ProviderConfig;
  systemPrompt: string;
  tools: ToolDefinition[];
  target: ExecutionTarget;
  maxTurns?: number;
  // Hook: ask the user to approve a tool use. Resolves to an allow/deny decision.
  requestPermission?: PermissionRequest;
  // Hook: persist conversation state (e.g., to SQLite). Called after each turn.
  onTurnEnd?: (messages: Message[]) => void;
}

export type PermissionRequest = (
  req: {
    toolName: string;
    input: Record<string, unknown>;
    description: string;
    signal: AbortSignal;
  },
) => Promise<PermissionResponse>;

export interface PermissionResponse {
  decision: 'allow' | 'deny';
  // Optional: remember this decision for the rest of the session / host / forever.
  remember?: 'session' | 'host' | 'global' | null;
}
