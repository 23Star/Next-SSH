// Public API of the agent module.
//
// Consumers (UI chat pane, panel modules, tests) should import from
// `renderer/agent` — never reach into sub-files. This keeps refactors
// contained: as long as these exports stay stable, internals can move.

export { runAgent } from './loop';
export type { AgentRunResult } from './loop';
export { PermissionStore, checkToolPermission } from './permissions';
export type { PermissionRule, RuleScope, RuleDecision } from './permissions';
export { buildSystemPrompt, SYSTEM_PROMPT_STATIC_CORE } from './systemPrompt';
export type { SystemPromptContext } from './systemPrompt';
export {
  DEFAULT_TOOLS,
  buildToolSet,
  BashTool,
  ListDirTool,
  ReadFileTool,
  SystemInfoTool,
} from './tools';
export type {
  AgentConfig,
  ContentBlock,
  ExecutionTarget,
  JsonSchema,
  Message,
  PermissionRequest,
  PermissionResponse,
  ProviderConfig,
  Role,
  StreamEvent,
  TextBlock,
  ToolContext,
  ToolDefinition,
  ToolResult,
  ToolResultBlock,
  ToolUseBlock,
} from './types';
