import { unstable_cache } from 'next/cache';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import type { TaxRow } from '@/db/rows';

/** Base tag; the live Data Cache entries carry the SHOP-SCOPED tag below. */
export const TAXES_CACHE_TAG = 'taxes';

/**
 * Shop-scoped cache tag for a shop's taxes. The tax-mutating Server Actions
 * bust it via `revalidateTag(taxesCacheTag(shopId))`.
 */
export function taxesCacheTag(shopId: string): string {
  return `${TAXES_CACHE_TAG}:${shopId}`;
}

/**
 * Cross-request cache of a shop's taxes (Vercel Data Cache), keyed by shop id
 * -- same per-shop pattern as `getCachedServices` in lib/data/calendar-config.ts.
 *
 * Taxes are slow-changing config read on /settings/taxes (and assignable on
 * /products + /services), so caching removes a cold Postgres query from those
 * loads. The pages stay dynamic (they read auth cookies); only the *query* is
 * cached. Service-role client + explicit `shop_id` scope -- service-role
 * bypasses RLS, so the shop filter is REQUIRED for tenant isolation; the caller
 * has already proven membership before we key by shopId.
 *
 * The tag is SHOP-SCOPED (`taxes:${shopId}`) so a tax edit in one shop only
 * busts THAT shop's entry -- a global `'taxes'` tag invalidated every tenant's
 * cache on any shop's edit (F3). 5-minute TTL is the fallback;
 * `createTax`/`updateTax`/`deleteTax` call `revalidateTag(taxesCacheTag(shopId))`
 * so edits show immediately.
 */
export function getCachedTaxes(shopId: string): Promise<TaxRow[]> {
  return unstable_cache(
    async (): Promise<TaxRow[]> => {
      const admin = createSupabaseServiceRoleClient();
      const { data } = await admin
        .from('taxes')
        .select('*')
        .eq('shop_id', shopId)
        .order('name', { ascending: true });
      return (data as TaxRow[] | null) ?? [];
    },
    ['taxes-rows', shopId],
    { revalidate: 300, tags: [taxesCacheTag(shopId)] },
  )();
}
