'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const SearchBar = forwardRef<HTMLInputElement, Props>(function SearchBar(
  { className, placeholder = 'Search…', ...rest },
  ref,
) {
  return (
    <div className={cn('relative w-full max-w-md', className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
      />
      <input
        ref={ref}
        type="search"
        placeholder={placeholder}
        className={cn(
          // Phase 75 — same Vercel-light treatment as the rest of the
          // form family (Input/Select/Textarea): shadow-sm provides
          // the ring-border, focus uses the saturated blue Vercel ring.
          'h-10 w-full rounded-lg bg-bg-surface-2 pl-9 pr-3 text-sm text-text-primary shadow-sm placeholder:text-text-muted',
          'transition-colors duration-150 ease-out-quint',
          'focus:outline-none focus:ring-2 focus:ring-focus',
        )}
        {...rest}
      />
    </div>
  );
});
