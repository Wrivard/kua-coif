import { Skeleton } from '@/components/ui/skeleton';

// Suspense fallback for every page under [locale]. Server components stream
// behind this while their data resolves.
export default function LocaleLoading() {
  return (
    <div className="flex min-h-screen flex-col gap-4 p-6">
      <Skeleton className="h-header-h w-full" />
      <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}
