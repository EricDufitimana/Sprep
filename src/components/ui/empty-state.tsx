import { Icon, type IconName } from './icon';

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  /** One line of direction — what to do next, not mood. */
  action: React.ReactNode;
  description?: string;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line bg-surface px-6 py-12 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-pill bg-blue-tint text-blue">
        <Icon name={icon} className="text-lg" />
      </span>
      <div>
        <p className="text-body font-semibold text-ink-900">{title}</p>
        {description && <p className="mt-1 max-w-sm text-small text-ink-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}
