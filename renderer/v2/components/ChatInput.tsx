// Single chat input: auto-growing textarea + send / stop button.
//
// Enter sends, Shift+Enter inserts a newline. The button morphs into a stop
// square while the agent is running so the user can always interrupt.

import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

export interface ChatInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  running: boolean;
  disabled?: boolean;
  placeholder?: string;
}

const MAX_HEIGHT = 180;

export function ChatInput({ onSend, onStop, running, disabled, placeholder }: ChatInputProps): React.ReactElement {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-resize the textarea to its content up to MAX_HEIGHT.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  const submit = (): void => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (running) return;
      submit();
    }
  };

  return (
    <div className="ns-chatinput" data-disabled={disabled}>
      <textarea
        ref={ref}
        className="ns-chatinput__area"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder ?? 'Ask the assistant…'}
        rows={1}
        disabled={disabled}
      />
      {running ? (
        <button
          type="button"
          className="ns-chatinput__btn"
          data-variant="stop"
          onClick={onStop}
          aria-label="Stop"
        >
          <Icon name="stop" size={16} />
        </button>
      ) : (
        <button
          type="button"
          className="ns-chatinput__btn"
          data-variant="send"
          onClick={submit}
          disabled={disabled || value.trim().length === 0}
          aria-label="Send"
        >
          <Icon name="send" size={16} />
        </button>
      )}
    </div>
  );
}
