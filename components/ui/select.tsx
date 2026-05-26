import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean;
};

export const Select = forwardRef<HTMLSelectElement, Props>(function Select(
  { className, invalid, children, ...rest },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          // Phase 75 — shadow-sm provides the ring-border; `border
          // border-border` removed to avoid double-rings. Focus ring
          // switched to Vercel saturated blue via `ring-focus`.
          'h-10 w-full appearance-none rounded-lg bg-bg-surface-2 pl-3 pr-9 shadow-sm',
          'text-sm text-text-primary',
          'transition-colors duration-150 ease-out-quint',
          'focus:outline-none focus:ring-2 focus:ring-focus',
          'disabled:cursor-not-allowed disabled:opacity-50',
          invalid && 'ring-1 ring-danger focus:ring-2',
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
      />
    </div>
  );
});
