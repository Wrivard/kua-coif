'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

/**
 * Single React Query client per browser tab. We create it lazily with useState
 * so the constructor only runs client-side (avoids hydration mismatch when the
 * server emits HTML for a different tab).
 *
 * Defaults:
 *  - 60s staleTime so navigating back to a screen doesn't refetch instantly
 *  - 0 retry on mutations (we surface errors to the user via toast)
 *  - refetchOnWindowFocus off — too noisy for a back-office tool
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
          mutations: { retry: 0 },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
