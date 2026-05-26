'use client';

import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type TabItem<V extends string> = {
  value: V;
  label: ReactNode;
  count?: number;
  disabled?: boolean;
};

type Props<V extends string> = {
  value: V;
  onChange: (next: V) => void;
  items: ReadonlyArray<TabItem<V>>;
  className?: string;
  'aria-label'?: string;
};

export function Tabs<V extends string>({ value, onChange, items, className, ...rest }: Props<V>) {
  return (
    <div
      role="tablist"
      aria-label={rest['aria-label']}
      className={cn('flex items-center gap-6 border-b border-border', className)}
    >
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={it.disabled}
            onClick={() => onChange(it.value)}
            className={cn(
              'relative -mb-px flex items-center gap-2 border-b-2 px-1 pb-3 pt-1 text-sm font-medium transition-colors',
              'focus:outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base',
              active
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary',
              it.disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            {it.label}
            {typeof it.count === 'number' ? (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                  active ? 'bg-accent-subtle text-accent' : 'bg-bg-surface-2 text-text-muted',
                )}
              >
                {it.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
