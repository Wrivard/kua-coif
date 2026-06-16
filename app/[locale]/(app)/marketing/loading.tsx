import { Skeleton } from '@/components/ui/skeleton';

/**
 * Route-segment loading skeleton for /marketing. Overrides the generic
 * `(app)/loading.tsx` with a shape that matches THIS page: the two-column grid
 * of marketing-tool cards above the coming-soon banner, so the transition
 * reads as "the page filled in" rather than a generic swap.
 */
export default function MarketingLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Page header band — title + subtitle lockup (no actions). */}
      <div className="flex h-header-h items-center gap-4 border-b border-border bg-bg-base/95 px-6 backdrop-blur">
        <Skeleton className="h-6 w-40" />
      </div>

      <div className="space-y-6 p-6">
        {/* Two-column grid of marketing-tool cards. */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-lg" />
        </div>
        {/* Coming-soon banner. */}
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    </div>
  );
}
