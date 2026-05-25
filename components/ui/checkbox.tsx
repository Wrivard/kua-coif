'use client';

import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & {
  label?: ReactNode;
};

export const Checkbox = forwardRef<HTMLInputElement, Props>(function Checkbox(
  { className, label, checked, disabled, id, ...rest },
  ref,
) {
  const control = (
    <span className="relative inline-flex h-4 w-4 shrink-0">
      <input
        ref={ref}
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        className="peer h-4 w-4 cursor-pointer appearance-none rounded-sm border border-border bg-bg-surface-2 transition-colors duration-150 ease-out-quint checked:border-accent checked:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base disabled:cursor-not-allowed disabled:opacity-50"
        {...rest}
      />
      <Check
        aria-hidden
        className="pointer-events-none absolute inset-0 m-auto h-3 w-3 text-accent-fg opacity-0 transition-opacity duration-150 peer-checked:opacity-100"
      />
    </span>
  );

  if (!label) return <span className={className}>{control}</span>;
  return (
    <label
      className={cn(
        'inline-flex cursor-pointer items-center gap-2',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      {control}
      <span className="text-sm text-text-primary">{label}</span>
    </label>
  );
});
