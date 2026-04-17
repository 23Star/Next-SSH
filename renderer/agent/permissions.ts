// Permission system for tool execution.
//
// Rules are held in-memory for the session and optionally persisted via
// `loadPersistedRules` / `persistRule` hooks (wired up later to SQLite or
// localStorage). The checker is deterministic: given the current rule set and
// a tool invocation, it returns allow/deny/ask without side effects. Actual
// UI prompts happen in `maybeAsk` which delegates to the AgentConfig hook.

import type {
  PermissionRequest,
  PermissionResponse,
  ToolDefinition,
  ToolUseBlock,
} from './types';

export type RuleScope = 'session' | 'host' | 'global';
export type RuleDecision = 'allow' | 'deny';

export interface PermissionRule {
  toolName: string;
  decision: RuleDecision;
  scope: RuleScope;
  // Optional: host identifier this rule applies to (only meaningful for scope='host').
  hostKey?: string;
  // Future: match specific input patterns (e.g., allow `bash` only when command starts with `ls`).
  // For v1 we match only on tool name.
}

export class PermissionStore {
  private rules: PermissionRule[] = [];

  constructor(initial: PermissionRule[] = []) {
    this.rules = [...initial];
  }

  addRule(rule: PermissionRule): void {
    // Replace any existing rule with the same (toolName, scope, hostKey) tuple.
    this.rules = this.rules.filter(
      (r) =>
        !(
          r.toolName === rule.toolName &&
          r.scope === rule.scope &&
          (r.hostKey ?? null) === (rule.hostKey ?? null)
        ),
    );
    this.rules.push(rule);
  }

  // Evaluate rules in priority order: session > host > global.
  // Returns the first matching decision, or null if no rule applies.
  evaluate(toolName: string, hostKey: string | null): RuleDecision | null {
    const byScope = (scope: RuleScope) =>
      this.rules.find(
        (r) =>
          r.toolName === toolName &&
          r.scope === scope &&
          (scope !== 'host' || r.hostKey === hostKey),
      );
    return (
      byScope('session')?.decision ??
      byScope('host')?.decision ??
      byScope('global')?.decision ??
      null
    );
  }

  list(): readonly PermissionRule[] {
    return this.rules;
  }

  // Drop session-scoped rules (e.g., when the user starts a fresh session).
  clearSession(): void {
    this.rules = this.rules.filter((r) => r.scope !== 'session');
  }
}

// Decide whether a tool call is allowed, asking the user if needed.
export async function checkToolPermission(opts: {
  tool: ToolDefinition;
  toolUse: ToolUseBlock;
  store: PermissionStore;
  hostKey: string | null;
  requestPermission?: PermissionRequest;
  signal: AbortSignal;
}): Promise<PermissionResponse> {
  const { tool, toolUse, store, hostKey, requestPermission, signal } = opts;

  // Auto-approve read-only tools. They carry no risk of state change.
  if (tool.isReadOnly(toolUse.input)) {
    return { decision: 'allow' };
  }

  const existing = store.evaluate(tool.name, hostKey);
  if (existing === 'allow') return { decision: 'allow' };
  if (existing === 'deny') return { decision: 'deny' };

  // No rule: ask the user.
  if (!requestPermission) {
    // No UI hook wired up → conservative default is deny. Callers must provide
    // a prompt hook for any real interactive session.
    return { decision: 'deny' };
  }
  const response = await requestPermission({
    toolName: tool.name,
    input: toolUse.input,
    description: tool.description,
    signal,
  });
  if (response.remember) {
    store.addRule({
      toolName: tool.name,
      decision: response.decision,
      scope: response.remember,
      hostKey: response.remember === 'host' ? hostKey ?? undefined : undefined,
    });
  }
  return response;
}
