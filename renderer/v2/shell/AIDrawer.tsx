// AI drawer — Phase 2a placeholder.
//
// This slot is where the new Claude Code-style agent UI will live: streaming
// assistant text, thinking blocks, tool_use cards with live status, tool
// result folds, permission prompts, and a single chat input. The agent loop
// already exists in renderer/agent/; wiring happens in Phase 3.
//
// For now we render an empty-state explaining what will appear here, so when
// the user hits the toggle they understand the slot and we can iterate on
// layout without placeholder-chrome baked in.

import React from 'react';
import { Icon } from '../components/Icon';

export interface AIDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function AIDrawer({ open, onClose }: AIDrawerProps): React.ReactElement {
  return (
    <aside className="ns-drawer" data-open={open} aria-hidden={!open}>
      <div className="ns-drawer__header">
        <div className="ns-drawer__title">
          <Icon name="sparkle" size={16} />
          <span>Assistant</span>
        </div>
        <button className="ns-iconbtn" onClick={onClose} aria-label="Close assistant">
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="ns-drawer__body">
        <div className="ns-empty" style={{ padding: '40px 12px' }}>
          <div className="ns-empty__icon">
            <Icon name="sparkle" size={20} />
          </div>
          <div className="ns-empty__title">Assistant — coming in Phase 3</div>
          <div style={{ maxWidth: 280, fontSize: 'var(--fs-sm)', lineHeight: 1.55 }}>
            The new AI runs on the same tools the panel uses — file listings,
            system snapshots, bash. You'll see every tool call inline as it
            happens, with approval prompts for anything that changes state.
          </div>
        </div>
      </div>
    </aside>
  );
}
