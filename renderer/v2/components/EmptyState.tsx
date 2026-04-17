import React from 'react';
import { Icon, type IconName } from './Icon';

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps): React.ReactElement {
  return (
    <div className="ns-empty">
      {icon && (
        <div className="ns-empty__icon">
          <Icon name={icon} size={22} />
        </div>
      )}
      <h2 className="ns-empty__title">{title}</h2>
      {description && <div style={{ maxWidth: 420, lineHeight: 1.55 }}>{description}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}
