'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

/**
 * Button — Phase 36 refinement.
 *
 * Changes from V1:
 *   - Primary: gains a subtle accent glow on hover (box-shadow ring),
 *     and an active "press" via scale-95. Pairs the color shift with a
 *     spatial cue — feels much more deliberate than a flat color swap.
 *   - Secondary: subtle inset highlight + hover bg lift.
 *   - Ghost: stays minimal, just hover bg.
 *   - Focus rings unchanged (already accent ring with offset).
 *   - All variants: active:scale-[0.98] for tactile press feedback.
 *
 * Transition duration 150ms / out-quint easing — fast and natural.
 */

const variants: Record<ButtonVariant, string> = {
  primary: cn(
    'bg-accent text-accent-fg shadow-sm',
    'hover:bg-accent-hover hover:shadow-accent-glow',
    'active:bg-accent-active',
    'focus-visible:ring-accent',
  ),
  secondary: cn(
    'bg-bg-surface text-text-primary border border-border shadow-sm',
    'hover:bg-bg-surface-2 hover:border-border-strong',
    'focus-visible:ring-accent',
  ),
  ghost: cn('text-text-primary', 'hover:bg-bg-surface-2', 'focus-visible:ring-accent'),
  danger: cn('bg-danger text-white shadow-sm', 'hover:opacity-90', 'focus-visible:ring-danger'),
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs rounded-sm',
  md: 'h-10 px-4 text-sm rounded',
  lg: 'h-12 px-5 text-base rounded-lg',
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { className, variant = 'primary', size = 'md', loading, disabled, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium',
        'transition-all duration-150 ease-out-quint',
        'active:scale-[0.98]',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : null}
      {children}
    </button>
  );
});
