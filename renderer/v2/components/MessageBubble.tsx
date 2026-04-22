// Simple message bubble for user + assistant text.
//
// Claude-style: user messages live inside a soft rounded pill; assistant text
// flows edge-to-edge inside the drawer (no bubble), so longer responses aren't
// visually constrained.

import React from 'react';
import { Icon } from './Icon';

export interface UserBubbleProps {
  text: string;
}

export function UserBubble({ text }: UserBubbleProps): React.ReactElement {
  return (
    <div className="ns-msg ns-msg--user">
      <div className="ns-msg__bubble">{text}</div>
    </div>
  );
}

export interface AssistantTextProps {
  text: string;
  streaming?: boolean;
}

export function AssistantText({ text, streaming }: AssistantTextProps): React.ReactElement {
  const visibleText = text.trim().length > 0 ? text : (streaming ? 'Processing…' : '');
  return (
    <div className="ns-msg ns-msg--assistant">
      <div className="ns-msg__avatar" aria-hidden>
        <Icon name="sparkle" size={14} />
      </div>
      <div className="ns-msg__text">
        {visibleText}
        {streaming && <span className="ns-msg__cursor" aria-hidden>▍</span>}
      </div>
    </div>
  );
}

export interface SystemNoteProps {
  text: string;
  tone: 'info' | 'warn' | 'error';
}

export function SystemNote({ text, tone }: SystemNoteProps): React.ReactElement {
  return (
    <div className="ns-msg ns-msg--system" data-tone={tone}>
      <Icon name={tone === 'info' ? 'sparkle' : 'warning'} size={14} />
      <span>{text}</span>
    </div>
  );
}
