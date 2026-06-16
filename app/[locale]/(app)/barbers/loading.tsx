import { Skeleton } from '@/components/ui/skeleton';

/**
 * Route-segment loading skeleton for /barbers. Overrides the generic
 * `(app)/loading.tsx` with a shape that matches THIS page: the header band
 * with a centered search + export/add actions, then the confirmed/staff/
 * deleted tab strip above the roster table, so the transition reads as "the
 * page filled in" rather than a generic swap.
 */
export default function BarbersLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Page header band — title, centered search, export + add actions. */}
      <div className="flex h-header-h items-center gap-4 border-b border-border bg-bg-base/95 px-6 backdrop-blur">
        <Skeleton className="h-6 w-32" />
        <div className="flex-1" />
        <Skeleton className="h-10 w-64" />
        <div className="flex-1" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-28" />
      </div>

      <div className="space-y-6 p-6">
        {/* Confirmed / staff / deleted tab strip. */}
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
        {/* The roster table. */}
        <Skeleton className="h-[480px] w-full rounded-lg" />
      </div>
    </div>
  );
}
