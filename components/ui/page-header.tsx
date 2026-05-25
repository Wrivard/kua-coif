import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  title: ReactNode;
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

export function PageHeader({ title, subtitle, center, actions, switcher, className }: Props) {
  return (
    <header
      className={cn(
        // pl-16 on mobile leaves room for the fixed hamburger trigger
        // (left-3 + w-10 = up to 52px) so the title doesn't sit underneath
        // it. md:px-6 restores the desktop padding once the hamburger
        // disappears.
        'bg-bg-base/95 sticky top-0 z-30 flex h-header-h items-center gap-4 border-b border-border pl-16 pr-4 backdrop-blur md:px-6',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold text-text-primary sm:text-xl">{title}</h1>
        {subtitle ? (
          <p className="mt-0.5 truncate text-[11px] text-text-muted sm:text-xs">{subtitle}</p>
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
