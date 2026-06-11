import { Skeleton } from '@/components/ui/skeleton';

/**
 * Loading skeleton for every page in the authenticated app shell.
 *
 * Why this exists (Phase 29 perf):
 *  - The sidebar layout above us is preserved across client navigations.
 *  - When a user clicks a sidebar link, Next.js renders THIS as a Suspense
 *    fallback in the main slot until the destination page's data resolves.
 *  - Without it, the previous page's content stayed frozen on screen during
 *    the data fetch — felt like the click did nothing.
 *
 * The skeleton mimics the universal shape (sticky PageHeader band + a
 * content card) so the transition feels like "the page filled in" rather
 * than "the page got swapped." We deliberately don't try to match the
 * exact destination — that would mean a per-page loading.tsx for each
 * route, which is overkill for a polish pass.
 */
export default function AppShellLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Page header band — matches the real PageHeader's height (--header-h). */}
      <div className="flex h-header-h items-center gap-4 border-b border-border bg-bg-base/95 px-6 backdrop-blur">
        <Skeleton className="h-6 w-40" />
        <div className="flex-1" />
        <Skeleton className="h-8 w-24" />
      </div>

      {/* Content area — a single tall card mimicking either a DataTable or
          a form. Both are the dominant patterns under (app). */}
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-20" />
        </div>
        <Skeleton className="h-[480px] w-full" />
      </div>
    </div>
  );
}
