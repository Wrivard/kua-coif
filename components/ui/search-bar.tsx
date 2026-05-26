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
          // Phase 49b — harmonize with the rest of the form family
          // (rounded-lg + shadow-sm + ring-2 ring-accent/30 standard
          // from Phase 47). Was the last input still on the V1 recipe.
          'h-10 w-full rounded-lg border border-border bg-bg-surface-2 pl-9 pr-3 text-sm text-text-primary shadow-sm placeholder:text-text-muted',
          'transition-colors duration-150 ease-out-quint',
          'focus:ring-accent/30 focus:border-accent focus:outline-none focus:ring-2',
        )}
        {...rest}
      />
    </div>
  );
});
