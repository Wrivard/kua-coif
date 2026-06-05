'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'danger';
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

// Phase 75 — Vercel button variants.
//   - Primary: dark (Vercel's primary CTA is #171717 not the accent)
//     OPTION — we keep accent purple for now since the Küa brand is
//     purple-led. Vercel would prefer text-primary background.
//   - Secondary: shadow-as-border replaces `border border-border`.
//   - Focus ring switches from soft accent to Vercel saturated blue.
//   - hover:border-border-strong replaced with a slightly stronger
//     shadow ring on hover.

// UI Refresh — disciplined-accent + precision pass:
//   - Disabled buttons are fully inert: every hover/press effect is gated
//     behind `enabled:` so the accent glow / bg-shift / press-scale never
//     lands on a non-actionable control.
//   - Focus ring unified to `ring-focus` on all variants (danger included)
//     for one consistent, high-visibility focus signal.
const variants: Record<ButtonVariant, string> = {
  primary: cn(
    'bg-accent text-accent-fg shadow-sm',
    'enabled:hover:bg-accent-hover enabled:hover:shadow-accent-glow',
    'enabled:active:bg-accent-active',
    'focus-visible:ring-focus',
  ),
  secondary: cn(
    'bg-bg-surface text-text-primary shadow-sm',
    'enabled:hover:bg-bg-surface-2 enabled:hover:shadow-border-strong',
    'focus-visible:ring-focus',
  ),
  // Tertiary — quiet, text-only tier. Starts muted and brightens on hover, so a
  // dense toolbar's secondary actions visually recede instead of reading as a
  // wall of equal-weight buttons. (UI Wave — accent discipline)
  tertiary: cn(
    'text-text-secondary',
    'enabled:hover:bg-bg-surface-2 enabled:hover:text-text-primary',
    'focus-visible:ring-focus',
  ),
  ghost: cn('text-text-primary', 'enabled:hover:bg-bg-surface-2', 'focus-visible:ring-focus'),
  danger: cn(
    'bg-danger text-white shadow-sm',
    'enabled:hover:opacity-90',
    'focus-visible:ring-focus',
  ),
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
        'enabled:active:scale-[0.98]',
        'disabled:cursor-not-allowed disabled:opacity-50',
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
