// ToolUseCard — shows a single tool invocation inline in the chat.
//
// Layout:
//   [status-dot] tool_name(one_line_input_summary)         [status-text]
//   ──────────────────────────────────────────────────── [expand ↴]
//   (on expand) full input JSON + result text
//
// The "one-line summary" highlights the signal the user cares about — for
// bash that's the command; for list_dir / read_file it's the path. Everything
// else falls back to a JSON preview.

import React, { useState } from 'react';
import { Icon } from './Icon';
import type { ToolUseItem } from '../lib/useAgent';

export interface ToolUseCardProps {
  item: ToolUseItem;
}

function oneLineSummary(name: string, input: Record<string, unknown>, partialArgs: string): string {
  if (Object.keys(input).length === 0 && partialArgs) {
    // Show live partial JSON while it streams in, truncated.
    return partialArgs.length > 80 ? partialArgs.slice(0, 80) + '…' : partialArgs;
  }
  if (Object.keys(input).length === 0) return '(waiting arguments)';
  switch (name) {
    case 'bash':
      return typeof input.command === 'string' ? input.command : JSON.stringify(input);
    case 'list_dir':
      return typeof input.path === 'string' ? input.path : JSON.stringify(input);
    case 'read_file': {
      const p = typeof input.path === 'string' ? input.path : '';
      const range = input.start_line || input.end_line
        ? ` [${input.start_line ?? '?'}..${input.end_line ?? '?'}]`
        : '';
      return `${p}${range}`;
    }
    case 'system_info':
      return '(host snapshot)';
    default: {
      const s = JSON.stringify(input);
      return s.length > 80 ? s.slice(0, 80) + '…' : s;
    }
  }
}

function statusLabel(status: ToolUseItem['status']): string {
  switch (status) {
    case 'pending': return 'Preparing…';
    case 'awaiting_permission': return 'Awaiting approval';
    case 'running': return 'Running…';
    case 'done': return 'Done';
    case 'error': return 'Error';
    case 'denied': return 'Denied';
  }
}

export function ToolUseCard({ item }: ToolUseCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const summary = oneLineSummary(item.name, item.input, item.partialArgs);
  const running = item.status === 'running' || item.status === 'pending' || item.status === 'awaiting_permission';
  const hasDetail = item.result != null || Object.keys(item.input).length > 0;

  return (
    <div className="ns-tool" data-status={item.status}>
      <button
        className="ns-tool__head"
        onClick={() => hasDetail && setExpanded((v) => !v)}
        disabled={!hasDetail}
        aria-expanded={expanded}
      >
        <span className="ns-tool__status" data-running={running}>
          <StatusGlyph status={item.status} />
        </span>
        <span className="ns-tool__name">{item.name}</span>
        <span className="ns-tool__arg" title={summary}>{summary}</span>
        <span className="ns-tool__label">{statusLabel(item.status)}</span>
        {hasDetail && (
          <span className="ns-tool__chev" data-open={expanded}>
            <Icon name="chevronDown" size={13} />
          </span>
        )}
      </button>
      {expanded && (
        <div className="ns-tool__body">
          {Object.keys(item.input).length > 0 && (
            <div className="ns-tool__section">
              <div className="ns-tool__section-title">Arguments</div>
              <pre className="ns-tool__pre">{JSON.stringify(item.input, null, 2)}</pre>
            </div>
          )}
          {item.result != null && (
            <div className="ns-tool__section">
              <div className="ns-tool__section-title">Result</div>
              <pre className="ns-tool__pre" data-tone={item.isError ? 'error' : undefined}>
                {item.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusGlyph({ status }: { status: ToolUseItem['status'] }): React.ReactElement {
  switch (status) {
    case 'done':
      return <Icon name="check" size={12} />;
    case 'error':
    case 'denied':
      return <Icon name="close" size={12} />;
    case 'awaiting_permission':
      return <Icon name="warning" size={12} />;
    default:
      return <Icon name="wrench" size={12} />;
  }
}
