'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from './badge';

export type SectionOption<V extends string> = {
  value: V;
  label: ReactNode;
  badge?: 'new';
};

type Props<V extends string> = {
  value: V;
  onChange: (next: V) => void;
  options: ReadonlyArray<SectionOption<V>>;
  className?: string;
  /** Label shown above the dropdown trigger (e.g. "View"). Optional. */
  trigger?: ReactNode;
};

export function SectionSwitcher<V extends string>({
  value,
  onChange,
  options,
  className,
  trigger,
}: Props<V>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn('relative inline-block', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'inline-flex h-10 items-center gap-2 rounded-md border border-border bg-bg-surface px-3 text-sm text-text-primary',
          'hover:bg-bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus',
        )}
      >
        {trigger ? <span className="text-xs text-text-muted">{trigger}</span> : null}
        <span className="font-medium">{current?.label}</span>
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute right-0 z-40 mt-1 w-60 overflow-hidden rounded-lg border border-border-soft bg-bg-elevated p-1 shadow-warm-md"
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors',
                    'focus:outline-none focus-visible:bg-bg-surface-2 focus-visible:ring-1 focus-visible:ring-focus',
                    active
                      ? 'bg-bg-surface-2 text-text-primary'
                      : 'text-text-secondary hover:bg-bg-surface-2 hover:text-text-primary',
                  )}
                >
                  <span className="flex items-center gap-2">
                    {opt.label}
                    {opt.badge === 'new' ? <Badge variant="new">New</Badge> : null}
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      'h-2 w-2 rounded-full',
                      active ? 'bg-accent' : 'border border-text-muted',
                    )}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
