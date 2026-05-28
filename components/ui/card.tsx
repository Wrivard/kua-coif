import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type DivProps = HTMLAttributes<HTMLDivElement>;

/**
 * Card — Phase 75 (Vercel-light pivot) elevated surface.
 *
 * Phase 75 dropped the `border border-border` because `shadow-sm` now
 * stacks ring-border + ambient drop. Doubling them produced a 2px-thick
 * "frame" effect. The new recipe is two ingredients:
 *   - rounded-lg (12px corners — Vercel "comfortable" radius)
 *   - shadow-sm (1px black-0.08 ring + 2px ambient drop)
 *   - bg-bg-surface (5% lift from #ffffff page → #fafafa)
 *
 * The shadow-as-border IS the border. Vercel rule.
 */
export function Card({ className, ...rest }: DivProps) {
  return <div className={cn('rounded-lg bg-bg-surface shadow-sm', className)} {...rest} />;
}

export function CardHeader({ className, ...rest }: DivProps) {
  return (
    <div
      className={cn(
        // Phase H+8 — py-5 → py-6 to match the Card breathing-room
        // uplift. Pairs with CardBody's py-6 so header + body share
        // the same vertical rhythm.
        'flex items-center justify-between gap-4 border-b border-border px-6 py-6',
        className,
      )}
      {...rest}
    />
  );
}

export function CardTitle({ className, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-sm font-semibold tracking-tight text-text-primary', className)}
      {...rest}
    />
  );
}

export function CardBody({ className, ...rest }: DivProps) {
  // Phase H+8 — py-5 → py-6 (20px → 24px vertical). Touches every
  // Card in the app; pages with stacked cards gain noticeable breathing
  // room without needing per-page tweaks.
  return <div className={cn('px-6 py-6', className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: DivProps) {
  return (
    <div
      className={cn(
        // Phase H+8 — py-4 → py-5 so footer rhythm sits midway between
        // header/body (py-6) and the underlying border. Footers usually
        // hold a single action row, so less padding than body is right.
        'flex items-center justify-end gap-2 border-t border-border px-6 py-5',
        className,
      )}
      {...rest}
    />
  );
}
