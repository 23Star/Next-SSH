import React from 'react';

export interface CardProps {
  title?: React.ReactNode;
  caption?: React.ReactNode;
  col?: 3 | 4 | 6 | 8 | 12;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function Card({ title, caption, col, action, children, className }: CardProps): React.ReactElement {
  return (
    <div className={`ns-card${className ? ` ${className}` : ''}`} data-col={col ?? 4}>
      {(title || action) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          {title && <h3 className="ns-card__title">{title}</h3>}
          {action}
        </div>
      )}
      {children}
      {caption && <div className="ns-card__caption">{caption}</div>}
    </div>
  );
}
