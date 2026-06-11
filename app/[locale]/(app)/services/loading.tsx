import { Skeleton } from '@/components/ui/skeleton';

/**
 * Route-segment loading skeleton for /services (Services W3 — products
 * parity). Overrides the generic `(app)/loading.tsx` with a shape that
 * matches THIS page: the header band with the manage/export/add actions
 * above the sortable services table, so the transition reads as "the page
 * filled in" rather than a generic swap.
 */
export default function ServicesLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Page header band — title + manage-categories / export / add actions. */}
      <div className="flex h-header-h items-center gap-4 border-b border-border bg-bg-base/95 px-6 backdrop-blur">
        <Skeleton className="h-6 w-32" />
        <div className="flex-1" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-32" />
      </div>

      <div className="p-6">
        {/* The sortable services table. */}
        <Skeleton className="h-[480px] w-full rounded-lg" />
      </div>
    </div>
  );
}
