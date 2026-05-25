import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Skeleton — Phase 36 shimmer treatment.
 *
 * Replaced the V1 `animate-pulse` (opacity wobble) with a horizontal
 * shimmer gradient that sweeps across the placeholder. Feels more
 * "premium" than pulsing — closer to how Linear/Vercel render loading
 * states. The animation is defined in `globals.css` as `kua-shimmer-bg`.
 */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('kua-shimmer-bg rounded bg-bg-surface-2', className)}
      aria-hidden
      {...rest}
    />
  );
}
