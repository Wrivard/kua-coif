import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * SectionMasthead — an eyebrow + section-title lockup that heads a *de-carded*
 * section. The revamp's settings pages stop wrapping every block in a Card
 * (over-carding reads cheap when elevation communicates no real hierarchy);
 * instead sections are grouped by negative space + a `border-t` divider and
 * introduced by this masthead. Pairs with an optional supporting line and a
 * right-aligned actions slot (e.g. a per-section "Add" button).
 */
export function SectionMasthead({
  eyebrow,
  title,
  supporting,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  supporting?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="type-eyebrow">{eyebrow}</p> : null}
        <h2 className="type-section-title">{title}</h2>
        {supporting ? <p className="mt-1 text-sm text-text-secondary">{supporting}</p> : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}
