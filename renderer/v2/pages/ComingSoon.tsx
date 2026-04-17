// Reusable empty page placeholder for modules we haven't wired up yet.
//
// Shown for everything except Dashboard in Phase 2a. The goal is to make
// navigation feel real (sidebar click → page header swap) while being
// transparent about what's implemented. Better than a blank screen and far
// better than leaking half-built UI.

import React from 'react';
import { EmptyState } from '../components/EmptyState';

export interface ComingSoonProps {
  title: string;
  hint?: string;
}

export function ComingSoon({ title, hint }: ComingSoonProps): React.ReactElement {
  return (
    <div className="ns-page">
      <div className="ns-page__header">
        <div>
          <h1 className="ns-page__title">{title}</h1>
          <div className="ns-page__subtitle">This module isn't built yet.</div>
        </div>
      </div>
      <EmptyState
        icon="sparkle"
        title={`${title} — coming soon`}
        description={hint ?? 'Wiring lands in a subsequent Phase 2 commit.'}
      />
    </div>
  );
}
