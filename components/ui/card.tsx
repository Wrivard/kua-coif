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
        // px-5 → px-6 + py-4 → py-5 for slightly more breathing room.
        'flex items-center justify-between gap-4 border-b border-border px-6 py-5',
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
  return <div className={cn('px-6 py-5', className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: DivProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-2 border-t border-border px-6 py-4',
        className,
      )}
      {...rest}
    />
  );
}
