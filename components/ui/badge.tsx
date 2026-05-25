import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type BadgeVariant = 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'new';

type Props = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

// Phase 36 — refined to use the subtle status colors from the new palette
// (bg-{kind}-subtle) which carry a built-in 12% alpha for proper depth
// against bg-bg-surface. Adds a 1px inset highlight via ring-inset for
// the "glass pill" look.
const variants: Record<BadgeVariant, string> = {
  default: 'bg-bg-surface-2 text-text-secondary ring-1 ring-inset ring-border',
  accent: 'bg-accent-subtle text-accent ring-1 ring-inset ring-accent/20',
  success: 'bg-success-subtle text-success ring-1 ring-inset ring-success/20',
  warning: 'bg-warning-subtle text-warning ring-1 ring-inset ring-warning/20',
  danger: 'bg-danger-subtle text-danger ring-1 ring-inset ring-danger/20',
  info: 'bg-info-subtle text-info ring-1 ring-inset ring-info/20',
  // "New" pill on User Settings — light-blue with dark text per annexe Image 1.
  new: 'bg-info text-black',
};

export function Badge({ className, variant = 'default', ...rest }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        variants[variant],
        className,
      )}
      {...rest}
    />
  );
}
