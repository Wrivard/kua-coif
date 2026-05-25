import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type DivProps = HTMLAttributes<HTMLDivElement>;

/**
 * Card — Phase 36 elevated surface.
 *
 * The visual recipe:
 *   - rounded-lg (12px corners — softer than the 8px V1 default)
 *   - shadow-sm (drop shadow + 1px inset highlight at the top edge)
 *   - bg-bg-surface (subtle lift from the page background)
 *   - border-border (alpha-based, barely-visible outline)
 *
 * That four-ingredient stack is what high-end dark SaaS surfaces
 * (Linear, Vercel) use for "this is a card, it's catching light from
 * above." Changing one weakens the effect — keep them together.
 */
export function Card({ className, ...rest }: DivProps) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-bg-surface shadow-sm', className)}
      {...rest}
    />
  );
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
