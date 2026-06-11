import { Skeleton } from '@/components/ui/skeleton';

/**
 * Route-segment loading skeleton for /finances (plan 034). Mirrors the real
 * page: header band with the today/disputes links, the date-range filter
 * strip, the KPI hero grid (gross revenue lead + three supporting metrics),
 * then the trend chart and by-barber table, so the transition reads as "the
 * page filled in" rather than the generic card swap.
 */
export default function FinancesLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Page header band — title + the two header links. */}
      <div className="flex h-header-h items-center gap-4 border-b border-border bg-bg-base/95 px-6 backdrop-blur">
        <Skeleton className="h-6 w-32" />
        <div className="flex-1" />
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-7 w-24" />
      </div>

      <div className="space-y-6 p-6">
        {/* Date-range filter strip. */}
        <Skeleton className="h-[72px] w-full rounded-lg" />

        {/* KPI hero — gross-revenue lead + three supporting metrics. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Skeleton className="h-36 w-full rounded-xl" />
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 lg:col-span-2">
            <Skeleton className="h-36 rounded-xl" />
            <Skeleton className="h-36 rounded-xl" />
            <Skeleton className="h-36 rounded-xl" />
          </div>
        </div>

        {/* Revenue trend chart. */}
        <Skeleton className="h-64 w-full rounded-lg" />

        {/* By-barber / commissions table. */}
        <Skeleton className="h-80 w-full rounded-lg" />
      </div>
    </div>
  );
}
