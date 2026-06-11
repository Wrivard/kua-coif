import { Skeleton } from '@/components/ui/skeleton';

/**
 * Route-segment loading skeleton for /clients (plan 034). Mirrors the real
 * list: header band with the search box + actions, the A–Z letter strip,
 * then the client table.
 */
export default function ClientsLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Page header band — title, centered search, duplicate/export/add actions. */}
      <div className="flex h-header-h items-center gap-4 border-b border-border bg-bg-base/95 px-6 backdrop-blur">
        <Skeleton className="h-6 w-32" />
        <div className="flex-1" />
        <Skeleton className="h-10 w-64" />
        <div className="flex-1" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-24" />
      </div>

      <div className="space-y-6 p-6">
        {/* A–Z letter filter strip. */}
        <Skeleton className="h-10 w-full rounded-lg" />
        {/* The client table. */}
        <Skeleton className="h-[480px] w-full rounded-lg" />
      </div>
    </div>
  );
}
