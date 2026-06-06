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
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-all duration-200 ease-out-quint active:scale-95',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-accent shadow-accent-glow' : 'border border-border bg-bg-surface-2',
      )}
      {...rest}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-out-quint',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  );

  if (!label) return <span className={className}>{control}</span>;
  // Phase H+8 fix — `inline-flex` made stacked Toggle siblings flow
  // horizontally instead of vertically (visible on /settings/widget
  // where multiple labelled toggles share a CardBody with space-y-*).
  // `flex w-fit` keeps the toggle pill compact while making each one
  // a block-level row, so space-y-* on the parent stacks them
  // properly. Existing uses inside flex rows / grid cells still
  // honor the parent's layout — `w-fit` keeps the pill from
  // stretching to fill the slot.
  return (
    <label className={cn('flex w-fit items-center gap-3', disabled && 'opacity-50', className)}>
      {control}
      <span className="text-sm text-text-primary">{label}</span>
    </label>
  );
}
