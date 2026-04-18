// AI drawer — wired to the agent loop.
//
// Content: header (title + clear button), transcript (user bubbles, assistant
// text, thinking blocks, tool cards, system notes), chat input. When the
// agent asks for permission a modal overlay opens inside the drawer.
//
// The transcript auto-scrolls to the latest item unless the user has
// scrolled up — a subtle courtesy that matches the Claude Code terminal.

import React, { useEffect, useRef } from 'react';
import { Icon } from '../components/Icon';
import { UserBubble, AssistantText, SystemNote } from '../components/MessageBubble';
import { ThinkingBlock } from '../components/ThinkingBlock';
import { ToolUseCard } from '../components/ToolUseCard';
import { PermissionDialog } from '../components/PermissionDialog';
import { ChatInput } from '../components/ChatInput';
import { useAgent } from '../lib/useAgent';
import type { ExecutionTarget } from '../../agent/types';
import type { SystemSnapshot } from '../../agent/tools/SystemInfo';

export interface AIDrawerProps {
  open: boolean;
  onClose: () => void;
  target: ExecutionTarget | null;
  hostLabel: string | null;
  snapshot: SystemSnapshot | null;
}

export function AIDrawer({ open, onClose, target, hostLabel, snapshot }: AIDrawerProps): React.ReactElement {
  const { items, status, pendingPermission, send, stop, reset } = useAgent({
    target,
    hostLabel,
    snapshot,
  });

  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const handler = (): void => {
      const slack = 24;
      stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < slack;
    };
    el.addEventListener('scroll', handler, { passive: true });
    return () => el.removeEventListener('scroll', handler);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [items]);

  const running = status === 'running' || status === 'awaiting_permission';
  const disabled = !target;

  return (
    <aside className="ns-drawer" data-open={open} aria-hidden={!open}>
      <div className="ns-drawer__header">
        <div className="ns-drawer__title">
          <Icon name="sparkle" size={16} />
          <span>Assistant</span>
          {hostLabel && <span className="ns-drawer__host">· {hostLabel}</span>}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            className="ns-iconbtn"
            onClick={reset}
            title="New conversation"
            aria-label="Clear conversation"
            disabled={items.length === 0}
          >
            <Icon name="refresh" size={16} />
          </button>
          <button className="ns-iconbtn" onClick={onClose} aria-label="Close assistant">
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>

      <div className="ns-drawer__list" ref={listRef}>
        {items.length === 0 ? (
          <div className="ns-empty" style={{ padding: '32px 12px' }}>
            <div className="ns-empty__icon">
              <Icon name="sparkle" size={20} />
            </div>
            <div className="ns-empty__title">Ask anything about this host</div>
            <div style={{ maxWidth: 280, fontSize: 'var(--fs-sm)', lineHeight: 1.55 }}>
              {target
                ? 'I can inspect, diagnose, and — with your approval — modify the target host. You\'ll see every tool call inline.'
                : 'Select a host from the top bar first. I run on the same connection.'}
            </div>
          </div>
        ) : (
          items.map((it) => {
            switch (it.kind) {
              case 'user':
                return <UserBubble key={it.id} text={it.text} />;
              case 'assistant_text':
                return <AssistantText key={it.id} text={it.text} streaming={it.streaming} />;
              case 'thinking':
                return (
                  <ThinkingBlock
                    key={it.id}
                    text={it.text}
                    durationMs={it.durationMs}
                    streaming={it.streaming}
                  />
                );
              case 'tool_use':
                return <ToolUseCard key={it.id} item={it} />;
              case 'system':
                return <SystemNote key={it.id} text={it.text} tone={it.tone} />;
            }
          })
        )}
      </div>

      <div className="ns-drawer__input">
        <ChatInput
          onSend={(t) => void send(t)}
          onStop={stop}
          running={running}
          disabled={disabled}
          placeholder={disabled ? 'Select a host first…' : 'Ask the assistant…'}
        />
      </div>

      {pendingPermission && <PermissionDialog pending={pendingPermission} />}
    </aside>
  );
}
