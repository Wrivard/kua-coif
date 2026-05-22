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
          'h-10 w-full rounded border border-border bg-bg-surface-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted',
          'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent',
        )}
        {...rest}
      />
    </div>
  );
});
