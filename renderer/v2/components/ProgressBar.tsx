import React from 'react';
import { percentToTone } from '../lib/format';

export interface ProgressBarProps {
  percent: number;
  tone?: 'success' | 'warn' | 'danger' | 'auto';
}

export function ProgressBar({ percent, tone = 'auto' }: ProgressBarProps): React.ReactElement {
  const clamped = Math.max(0, Math.min(100, percent));
  const resolvedTone = tone === 'auto' ? percentToTone(clamped) : tone;
  return (
    <div className="ns-bar" role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
      <div className="ns-bar__fill" data-tone={resolvedTone} style={{ width: `${clamped}%` }} />
    </div>
  );
}
