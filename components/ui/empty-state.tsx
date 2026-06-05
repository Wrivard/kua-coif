import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  /**
   * When `tone` is `accent`, the icon halo uses the brand accent tint. When
   * `danger` (used by the app-shell error boundary), the halo + icon shift
   * to the danger color. Defaults to `accent`. The caller still owns the
   * icon's color via the icon element itself — `tone` only drives the halo.
   */
  tone?: 'accent' | 'danger';
};

/**
 * Premium empty state — Phase 47c. The icon now sits inside a 56px halo
 * with a tinted background + outer ring, giving the slot a designed look
 * instead of a wireframe. Typography hierarchy is tightened: title sits at
 * `text-base font-semibold tracking-tight` (was text-sm), description uses
 * `leading-relaxed` and a tighter max-width for readable two-line copy.
 * Because the block is centered, `text-balance` evens the title's line
 * lengths and `text-pretty` keeps the description free of orphan words.
 *
 * Compatible with all existing call sites (services list, page placeholder,
 * data-table no-results, error boundary). Data-table passes
 * `rounded-none border-0` via className to flatten the container — that
 * still works since tailwind-merge resolves overrides correctly.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  tone = 'accent',
}: Props) {
  const haloClasses =
    tone === 'danger'
      ? 'bg-danger/10 text-danger ring-1 ring-inset ring-danger/15'
      : 'bg-accent-subtle text-accent ring-1 ring-inset ring-accent/15';
  return (
    <div
      className={cn(
        // Phase 75 — dashed border was a wireframe vibe that clashed
        // with Vercel's "shadow does the border" philosophy. Switched
        // to the standard shadow-sm card recipe (ring-border + ambient
        // drop). The icon halo still carries the "empty-but-designed"
        // intent.
        'flex flex-col items-center justify-center gap-4 rounded-lg bg-bg-surface px-6 py-16 text-center shadow-sm',
        className,
      )}
    >
      {icon ? (
        <div
          className={cn('flex h-14 w-14 items-center justify-center rounded-full', haloClasses)}
          aria-hidden
        >
          {icon}
        </div>
      ) : null}
      <div className="space-y-1.5">
        <h3 className="text-balance text-base font-semibold tracking-tight text-text-primary">
          {title}
        </h3>
        {description ? (
          <p className="mx-auto max-w-sm text-pretty text-sm leading-relaxed text-text-secondary">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
