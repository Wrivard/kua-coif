import { Skeleton } from '@/components/ui/skeleton';

/**
 * Loading skeleton for the /review token page (plan 034). A narrow centered
 * column (title, star row, comment box, submit), matching the review form's
 * real max-w-lg container.
 */
export default function ReviewLoading() {
  return (
    <div className="mx-auto max-w-lg space-y-6 p-6">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-12 w-full rounded-lg" />
      <Skeleton className="h-40 w-full rounded-lg" />
      <Skeleton className="h-10 w-32" />
    </div>
  );
}
