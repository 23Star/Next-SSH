// Modal prompt shown when the agent wants to run a non-read-only tool.
//
// The user picks allow or deny, optionally with a "remember" scope —
// matching Claude Code's three-tier remember (session / host / global). The
// hook resolves the agent's permission promise based on their choice.

import React, { useState } from 'react';
import type { PendingPermission } from '../lib/useAgent';
import type { PermissionResponse } from '../../agent/types';

export interface PermissionDialogProps {
  pending: PendingPermission;
}

type RememberScope = 'once' | 'session' | 'host' | 'global';

export function PermissionDialog({ pending }: PermissionDialogProps): React.ReactElement {
  const [remember, setRemember] = useState<RememberScope>('once');

  const decide = (decision: 'allow' | 'deny'): void => {
    const response: PermissionResponse = {
      decision,
      remember: remember === 'once' ? null : remember,
    };
    pending.decide(response);
  };

  const summary = summarize(pending.toolName, pending.input);

  return (
    <div className="ns-permission" role="dialog" aria-modal>
      <div className="ns-permission__card">
        <div className="ns-permission__title">Run <code>{pending.toolName}</code>?</div>
        <div className="ns-permission__desc">{pending.description}</div>
        {summary && (
          <pre className="ns-permission__code">{summary}</pre>
        )}

        <div className="ns-permission__scope">
          <div className="ns-permission__scope-label">Remember this choice</div>
          <div className="ns-permission__scope-row">
            {(['once', 'session', 'host', 'global'] as const).map((s) => (
              <button
                key={s}
                className="ns-chip"
                data-active={remember === s}
                onClick={() => setRemember(s)}
              >
                {SCOPE_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        <div className="ns-permission__actions">
          <button className="ns-btn" onClick={() => decide('deny')}>
            Deny
          </button>
          <button className="ns-btn" data-variant="primary" onClick={() => decide('allow')}>
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}

const SCOPE_LABEL: Record<RememberScope, string> = {
  once: 'Just once',
  session: 'Session',
  host: 'This host',
  global: 'Always',
};

function summarize(tool: string, input: Record<string, unknown>): string | null {
  if (tool === 'bash' && typeof input.command === 'string') return `$ ${input.command}`;
  if (Object.keys(input).length === 0) return null;
  return JSON.stringify(input, null, 2);
}
