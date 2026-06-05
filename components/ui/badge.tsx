import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type BadgeVariant = 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'new';
export type BadgeSize = 'sm' | 'md' | 'lg';

type Props = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
  /**
   * Loop 47 (P113) — pill family sizing. `sm` (default) keeps the
   * original 10px/uppercase tight pill for inline status indicators
   * next to titles. `md` is 11px/regular-case for richer surfaces
   * (status panels, info cards) where the badge IS the focal point.
   * `lg` is 13px and is reserved for empty-state hero cards.
   */
  size?: BadgeSize;
  /**
   * Loop 47 (P113) — leading colored dot. Bumps the readability of
   * status badges where the variant's tinted background isn't
   * enough on its own (e.g. inside a dense table cell). The dot
   * borrows the variant's text color so it stays in sync without an
   * extra palette knob.
   */
  dot?: boolean;
};

// Phase 36 — refined to use the subtle status colors from the new palette
// (bg-{kind}-subtle) which carry a built-in 12% alpha for proper depth
// against bg-bg-surface. Adds a 1px inset highlight via ring-inset for
// the "glass pill" look.
const variants: Record<BadgeVariant, string> = {
  default: 'bg-bg-surface-2 text-text-secondary ring-1 ring-inset ring-border',
  accent: 'bg-accent-subtle text-accent ring-1 ring-inset ring-accent/20',
  success: 'bg-success-subtle text-success ring-1 ring-inset ring-success/20',
  warning: 'bg-warning-subtle text-warning ring-1 ring-inset ring-warning/20',
  danger: 'bg-danger-subtle text-danger ring-1 ring-inset ring-danger/20',
  info: 'bg-info-subtle text-info ring-1 ring-inset ring-info/20',
  // "New" pill on User Settings — light-blue with dark text per annexe Image 1.
  new: 'bg-info text-black',
};

// Loop 47 — size classes. `sm` matches the historical inline pill;
// `md` and `lg` are new options for richer surfaces. The padding +
// font-size scale together so the pill stays visually proportioned.
const sizes: Record<BadgeSize, string> = {
  sm: 'gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
  md: 'gap-1.5 px-2.5 py-1 text-[11px] font-semibold tracking-tight',
  lg: 'gap-2 px-3 py-1 text-[13px] font-semibold tracking-tight',
};

const dotSize: Record<BadgeSize, string> = {
  sm: 'h-1.5 w-1.5',
  md: 'h-2 w-2',
  lg: 'h-2.5 w-2.5',
};

export function Badge({
  className,
  variant = 'default',
  size = 'sm',
  dot,
  children,
  ...rest
}: Props) {
  return (
    <span
      className={cn(
        // UI refresh wave — precision pass. Lock the pill to an exact
        // height (leading-none + items-center, no line-box slack), keep
        // a status label atomic so it never wraps (whitespace-nowrap),
        // and sit true-centered against adjacent inline text/headings
        // (align-middle). Pure layout/type — adds no color, so both the
        // light and dark themes still resolve through the token classes
        // below.
        'inline-flex items-center whitespace-nowrap rounded-full align-middle leading-none',
        sizes[size],
        variants[variant],
        className,
      )}
      {...rest}
    >
      {dot ? (
        // The dot uses `currentColor` so it always matches the badge
        // text — no extra prop, no per-variant override. Aria-hidden
        // because the badge label already conveys the meaning;
        // duplicating it through alt-text would confuse screen
        // readers.
        <span
          aria-hidden
          className={cn('inline-block shrink-0 rounded-full bg-current', dotSize[size])}
        />
      ) : null}
      {children}
    </span>
  );
}
