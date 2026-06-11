import { Skeleton } from '@/components/ui/skeleton';

/**
 * Route-segment loading skeleton for /products. Overrides the generic
 * `(app)/loading.tsx` with a shape that matches THIS page: the retail /
 * wholesale / low-stock stat strip above a dense product table, so the
 * transition reads as "the page filled in" rather than a generic swap.
 */
export default function ProductsLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Page header band — height matches the real PageHeader (--header-h),
          with placeholders for the search box + add action. */}
      <div className="flex h-header-h items-center gap-4 border-b border-border bg-bg-base/95 px-6 backdrop-blur">
        <Skeleton className="h-6 w-32" />
        <div className="flex-1" />
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-8 w-24" />
      </div>

      <div className="space-y-6 p-6">
        {/* Stat strip — retail / wholesale / low-inventory rollups. */}
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          <Skeleton className="h-12 w-36" />
          <Skeleton className="h-12 w-36" />
          <Skeleton className="h-12 w-24" />
        </div>
        {/* The product table. */}
        <Skeleton className="h-[480px] w-full" />
      </div>
    </div>
  );
}
