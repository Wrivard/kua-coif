import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  title: ReactNode;
  /** Small uppercase overline above the title (refonte masthead lockup). */
  eyebrow?: ReactNode;
  /** Optional second line shown under the title, smaller and muted. */
  subtitle?: ReactNode;
  /** Optional centered slot — typically a SearchBar. */
  center?: ReactNode;
  /** Right-hand slot for action buttons. */
  actions?: ReactNode;
  /** Far-right slot for a SectionSwitcher dropdown (when a page has sub-views). */
  switcher?: ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  eyebrow,
  subtitle,
  center,
  actions,
  switcher,
  className,
}: Props) {
  return (
    <header
      className={cn(
        // Phase 36 — refined sticky treatment:
        //   - `bg-bg-base/80` + heavier backdrop-blur (12px instead of
        //     default 8px) for a more "frosted" feel as content scrolls
        //     underneath.
        //   - `pl-16 md:px-6` reserves space for the mobile hamburger.
        //   - Border bottom kept at `border-border` (alpha-based).
        'sticky top-0 z-30 flex h-header-h items-center gap-4 border-b border-border bg-bg-base/80 pl-16 pr-4 backdrop-blur-xl md:px-6',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {/* Refonte masthead: an optional uppercase eyebrow over a
            display-md title, with a mono/tabular subtitle. The two-line
            lockup + larger title give every screen a confident anchor. */}
        {eyebrow ? <p className="type-eyebrow mb-1 truncate">{eyebrow}</p> : null}
        <h1 className="truncate text-display-md text-text-primary">{title}</h1>
        {subtitle ? (
          <p className="mt-1 truncate text-[11px] tabular-nums text-text-muted sm:text-xs">
            {subtitle}
          </p>
        ) : null}
      </div>
      {/* Center slot hides under `sm` — there's no horizontal room for it
          beside the title + actions on a phone. */}
      {center ? <div className="hidden flex-1 justify-center sm:flex">{center}</div> : null}
      <div className="flex items-center gap-2">
        {actions}
        {switcher}
      </div>
    </header>
  );
}
