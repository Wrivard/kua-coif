import { Skeleton } from '@/components/ui/skeleton';

/**
 * Loading skeleton for the /me client hub (plan 034). Token pages are
 * single-column mobile cards with no app shell — match that shape (greeting,
 * loyalty card, upcoming appointments, shop contact) instead of streaming
 * behind the desktop-app-shaped locale fallback and re-arranging.
 */
export default function MeLoading() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-48 w-full rounded-lg" />
      <Skeleton className="h-24 w-full rounded-lg" />
    </div>
  );
}
