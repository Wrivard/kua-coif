import { Skeleton } from '@/components/ui/skeleton';

/**
 * Loading skeleton for the /reschedule token page (plan 034). A narrow
 * centered column (heading, current-appointment card, slot picker), matching
 * reschedule-client's real max-w-lg container.
 */
export default function RescheduleLoading() {
  return (
    <div className="mx-auto max-w-lg space-y-6 p-6">
      <Skeleton className="h-6 w-44" />
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  );
}
