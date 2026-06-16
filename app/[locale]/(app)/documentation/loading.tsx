import { Skeleton } from '@/components/ui/skeleton';

/**
 * Route-segment loading skeleton for /documentation. Overrides the generic
 * `(app)/loading.tsx` with a shape that matches THIS page: the search box atop
 * the centered browser, then the feature nav rail beside the article column,
 * so the transition reads as "the page filled in" rather than a generic swap.
 */
export default function DocumentationLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Page header band — eyebrow + title + subtitle lockup (no actions). */}
      <div className="flex h-header-h items-center gap-4 border-b border-border bg-bg-base/95 px-6 backdrop-blur">
        <Skeleton className="h-6 w-40" />
      </div>

      <div className="p-4 md:p-6">
        <div className="mx-auto max-w-5xl">
          {/* Search box. */}
          <Skeleton className="mb-6 h-11 w-full rounded-lg" />

          <div className="flex flex-col gap-6 md:flex-row">
            {/* Feature nav rail. */}
            <div className="flex flex-col gap-2 md:w-60 md:shrink-0">
              <Skeleton className="h-9 w-full rounded-md" />
              <Skeleton className="h-9 w-full rounded-md" />
              <Skeleton className="h-9 w-full rounded-md" />
              <Skeleton className="h-9 w-full rounded-md" />
              <Skeleton className="h-9 w-full rounded-md" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
            {/* Article column. */}
            <Skeleton className="h-[480px] flex-1 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}
