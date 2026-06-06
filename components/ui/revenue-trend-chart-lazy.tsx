'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from './skeleton';

/**
 * Lazy boundary for the revenue trend chart. Defers recharts (~100kB) out
 * of the finances route's initial JS — it only downloads when the chart
 * actually mounts (revenue > 0). `ssr: false` because recharts measures the
 * DOM and has no useful server render; the Skeleton holds the 224px slot so
 * the page doesn't reflow when the chunk lands.
 *
 * The wrapper is a Client Component so `next/dynamic({ ssr: false })` is
 * legal here (it isn't in a Server Component). The server-rendered finances
 * page imports THIS instead of the chart directly.
 */
export const RevenueTrendChart = dynamic(
  () => import('./revenue-trend-chart').then((m) => m.RevenueTrendChart),
  { ssr: false, loading: () => <Skeleton className="h-56 w-full" /> },
);
