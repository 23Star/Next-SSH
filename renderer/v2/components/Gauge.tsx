// Minimal SVG ring gauge. Used for CPU load.
//
// Percent is drawn as an arc over a soft background ring. No animation lib —
// CSS transition on stroke-dashoffset handles the smoothing.

import React from 'react';

export interface GaugeProps {
  percent: number;          // 0–100
  label?: string;
  valueText?: string;       // override the center number; defaults to "percent%"
  size?: number;            // px; default 120
}

export function Gauge({ percent, label, valueText, size = 120 }: GaugeProps): React.ReactElement {
  const clamped = Math.max(0, Math.min(100, percent));
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (clamped / 100) * c;

  return (
    <div className="ns-gauge" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          className="ns-gauge__track"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
        />
        <circle
          className="ns-gauge__fill"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ns-gauge__center">
        <div className="ns-gauge__value">{valueText ?? `${Math.round(clamped)}%`}</div>
        {label && <div className="ns-gauge__label">{label}</div>}
      </div>
    </div>
  );
}
