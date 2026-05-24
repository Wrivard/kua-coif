import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('animate-pulse rounded bg-bg-surface-2', className)} aria-hidden {...rest} />
  );
}
