'use client';

import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
};

export function Toggle({ checked, onChange, label, disabled, className, id, ...rest }: Props) {
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      id={id}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-all duration-200 ease-out-quint',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-accent shadow-accent-glow' : 'border border-border bg-bg-surface-2',
      )}
      {...rest}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ease-out-quint',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  );

  if (!label) return <span className={className}>{control}</span>;
  return (
    <label className={cn('inline-flex items-center gap-3', disabled && 'opacity-50', className)}>
      {control}
      <span className="text-sm text-text-primary">{label}</span>
    </label>
  );
}
