import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type CalloutVariant = 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

type Props = HTMLAttributes<HTMLDivElement> & {
  variant?: CalloutVariant;
  /** Optional leading icon, rendered decorative (aria-hidden) — the text carries the meaning. */
  icon?: ReactNode;
  /** Optional emphasized first line above the body. */
  title?: ReactNode;
};

// Plan 030 — inline alert/callout primitive. Mirrors the Badge token recipe
// (bg-{v}-subtle + ring-{v}/20) so tinted feedback blocks stop hand-rolling
// `border-{status}/30 bg-{status}/10 …` with drifting radius/shadow/tint.
// Presentational only: no state, no dismiss, no toasts.
const variants: Record<CalloutVariant, string> = {
  default: 'bg-bg-surface-2 text-text-secondary ring-1 ring-inset ring-border',
  accent: 'bg-accent-subtle text-accent-text ring-1 ring-inset ring-accent/20',
  success: 'bg-success-subtle text-success ring-1 ring-inset ring-success/20',
  warning: 'bg-warning-subtle text-warning ring-1 ring-inset ring-warning/20',
  danger: 'bg-danger-subtle text-danger ring-1 ring-inset ring-danger/20',
  info: 'bg-info-subtle text-info ring-1 ring-inset ring-info/20',
};

export function Callout({ className, variant = 'default', icon, title, children, ...rest }: Props) {
  const body =
    title != null ? (
      <div className="space-y-1">
        <div className="font-medium">{title}</div>
        {children}
      </div>
    ) : (
      children
    );

  return (
    <div
      // Urgent variants interrupt (role="alert"); the rest announce politely.
      // Callers can still override via the `role` rest prop.
      role={variant === 'danger' || variant === 'warning' ? 'alert' : 'status'}
      className={cn(
        'rounded-lg px-3 py-2 text-sm',
        icon != null && 'flex gap-2',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {icon != null ? (
        <>
          <span aria-hidden className="mt-0.5 shrink-0">
            {icon}
          </span>
          <div className="min-w-0 flex-1">{body}</div>
        </>
      ) : (
        body
      )}
    </div>
  );
}
