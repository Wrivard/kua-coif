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
        'sticky top-0 z-30 flex h-header-h items-center gap-4 border-b border-border bg-bg-base/95 px-6 backdrop-blur',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-semibold text-text-primary">{title}</h1>
        {subtitle ? <p className="mt-0.5 truncate text-xs text-text-muted">{subtitle}</p> : null}
      </div>
      {center ? <div className="flex flex-1 justify-center">{center}</div> : null}
      <div className="flex items-center gap-2">
        {actions}
        {switcher}
      </div>
    </header>
  );
}
