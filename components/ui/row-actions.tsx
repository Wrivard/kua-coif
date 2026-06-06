import type { ComponentType } from 'react';
import { cn } from '@/lib/utils';

export type RowActionTone = 'default' | 'danger' | 'warning';

export type RowAction = {
  /** lucide-react icon component, rendered at h-4 w-4. */
  icon: ComponentType<{ className?: string }>;
  /** aria-label — these are icon-only buttons, so a label is required. */
  label: string;
  onClick: () => void;
  /** Tints the hover state: `danger` → red, `warning` → amber. */
  tone?: RowActionTone;
  /** Optional native tooltip; the aria-label already carries the meaning. */
  title?: string;
  disabled?: boolean;
};

/**
 * Standard trailing-actions cell for CRUD DataTables: a right-aligned row
 * of icon-only buttons (edit, delete, toggle, …).
 *
 * Centralizing this fixes the drift where some tables shipped the
 * focus-visible ring + hover transition and others didn't. Each button
 * stops click propagation so it works inside a clickable row without also
 * firing the row's own onClick.
 */
export function RowActions({ actions, className }: { actions: RowAction[]; className?: string }) {
  return (
    <div className={cn('flex items-center justify-end gap-1', className)}>
      {actions.map((action) => (
        <RowActionButton key={action.label} {...action} />
      ))}
    </div>
  );
}

export function RowActionButton({
  icon: Icon,
  label,
  onClick,
  tone = 'default',
  title,
  disabled,
}: RowAction) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'rounded-md p-1 text-text-muted transition-colors duration-150 ease-out-quint hover:bg-bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50',
        tone === 'danger'
          ? 'hover:text-danger'
          : tone === 'warning'
            ? 'hover:text-warning'
            : 'hover:text-text-primary',
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
