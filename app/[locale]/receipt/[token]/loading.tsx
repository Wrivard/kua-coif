import { Skeleton } from '@/components/ui/skeleton';

/**
 * Loading skeleton for the /receipt token page (plan 034). Single centered
 * receipt card (no app shell), matching receipt-client's container so the
 * skeleton→content swap doesn't shift layout.
 */
export default function ReceiptLoading() {
  return (
    <div className="min-h-screen bg-bg-base p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-96 w-full rounded-lg" />
        <Skeleton className="h-10 w-36" />
      </div>
    </div>
  );
}
