// Collapsible "thinking" block (reasoning trace).
//
// While the model is still streaming its reasoning, we show the tail so the
// user has something to read. Once finished, we collapse it behind a "Thought
// for X.Xs" toggle — matching the Claude Code presentation.

import React, { useState, useEffect, useRef } from 'react';
import { Icon } from './Icon';

export interface ThinkingBlockProps {
  text: string;
  durationMs: number | null;
  streaming: boolean;
}

export function ThinkingBlock({ text, durationMs, streaming }: ThinkingBlockProps): React.ReactElement {
  const [open, setOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-collapse once streaming stops, so the chat log stays compact.
  useEffect(() => {
    if (!streaming) setOpen(false);
  }, [streaming]);

  useEffect(() => {
    if (streaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [text, streaming]);

  const seconds = durationMs != null ? (durationMs / 1000).toFixed(1) : null;
  const headerText = streaming
    ? 'Thinking…'
    : seconds
      ? `Thought for ${seconds}s`
      : 'Thought';

  return (
    <div className="ns-thinking" data-open={open}>
      <button
        className="ns-thinking__header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Icon name="brain" size={14} />
        <span>{headerText}</span>
        <span className="ns-thinking__chev" data-open={open}>
          <Icon name="chevronDown" size={14} />
        </span>
      </button>
      {open && (
        <div className="ns-thinking__body" ref={scrollRef}>
          {text || (streaming ? '…' : '(no reasoning content)')}
        </div>
      )}
    </div>
  );
}
