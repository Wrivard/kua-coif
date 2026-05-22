import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ icon, title, description, action, className }: Props) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded border border-dashed border-border bg-bg-surface px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? <div className="text-text-muted">{icon}</div> : null}
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      {description ? <p className="max-w-md text-sm text-text-secondary">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
