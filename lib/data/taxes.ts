import { unstable_cache } from 'next/cache';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import type { TaxRow } from '@/db/rows';

/** Bust this from any tax-mutating Server Action via `revalidateTag`. */
export const TAXES_CACHE_TAG = 'taxes';

/**
 * Cross-request cache of a shop's taxes (Vercel Data Cache), keyed by shop
 * id — same two-layer pattern as `getCachedShopRow` in lib/auth/server.ts.
 *
 * Taxes are slow-changing config read on /settings/taxes (and assignable on
 * /products + /services), so caching removes a cold Postgres query from those
 * loads. The pages stay dynamic (they read auth cookies); only the *query*
 * is cached. Service-role client + explicit `shop_id` scope — service-role
 * bypasses RLS, so the shop filter is REQUIRED for tenant isolation; the
 * caller has already proven membership before we key by shopId.
 *
 * 5-minute TTL is the fallback; `createTax`/`updateTax`/`deleteTax` call
 * `revalidateTag('taxes')` so edits show immediately.
 */
export const getCachedTaxes = unstable_cache(
  async (shopId: string): Promise<TaxRow[]> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseServiceRoleClient() as any;
    const { data } = await admin
      .from('taxes')
      .select('*')
      .eq('shop_id', shopId)
      .order('name', { ascending: true });
    return (data as TaxRow[] | null) ?? [];
  },
  ['taxes-rows'],
  { revalidate: 300, tags: [TAXES_CACHE_TAG] },
);
