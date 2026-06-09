import { unstable_cache } from 'next/cache';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import type { ServiceRow, ServiceCategoryRow } from '@/db/rows';

/**
 * Cross-request caches (Vercel Data Cache) of a shop's slow-changing,
 * shop-UNIFORM calendar config, keyed by shop id — same pattern as
 * `getCachedTaxes` (lib/data/taxes.ts) and `getCachedShopRow`
 * (lib/auth/server.ts).
 *
 * The calendar page re-runs these reads on every load AND every Realtime
 * refresh, yet services / categories / hours / days-off change a handful of
 * times a week. They carry NO per-viewer variance (every shop member sees the
 * same list — unlike appointments/blocked_time, which are strict-barber
 * scoped), so a single per-shop cache entry is correct to share across all of
 * a shop's members. The appointment/blocked/barber reads stay on the live
 * RLS client; only this static config is cached.
 *
 * Service-role client + explicit `shop_id` scope — service-role bypasses RLS,
 * so the shop filter is REQUIRED for tenant isolation; the caller
 * (`requireShopMember` in the page) has already proven membership before we
 * key by shopId.
 *
 * 5-minute TTL is the fallback; the mutating Server Actions call
 * `revalidateShopConfig()` (lib/server-actions/revalidate.ts) so edits show
 * immediately.
 */
export const SERVICES_CACHE_TAG = 'services';
export const SERVICE_CATEGORIES_CACHE_TAG = 'service-categories';
export const SHOP_HOURS_CACHE_TAG = 'shop-hours';
export const SHOP_DAYS_OFF_CACHE_TAG = 'shop-days-off';

export type ShopHoursLite = {
  weekday: number;
  enabled: boolean;
  open_time: string | null;
  close_time: string | null;
};

export const getCachedServices = unstable_cache(
  async (shopId: string): Promise<ServiceRow[]> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseServiceRoleClient() as any;
    const { data } = await admin
      .from('services')
      .select('*')
      .eq('shop_id', shopId)
      .order('sort_order', { ascending: true });
    return (data as ServiceRow[] | null) ?? [];
  },
  ['calendar-services'],
  { revalidate: 300, tags: [SERVICES_CACHE_TAG] },
);

export const getCachedServiceCategories = unstable_cache(
  async (shopId: string): Promise<ServiceCategoryRow[]> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseServiceRoleClient() as any;
    const { data } = await admin
      .from('service_categories')
      .select('*')
      .eq('shop_id', shopId)
      .order('sort_order', { ascending: true });
    return (data as ServiceCategoryRow[] | null) ?? [];
  },
  ['calendar-service-categories'],
  { revalidate: 300, tags: [SERVICE_CATEGORIES_CACHE_TAG] },
);

export const getCachedShopHours = unstable_cache(
  async (shopId: string): Promise<ShopHoursLite[]> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseServiceRoleClient() as any;
    const { data } = await admin
      .from('shop_hours')
      .select('weekday, enabled, open_time, close_time')
      .eq('shop_id', shopId)
      .order('weekday', { ascending: true });
    return (data as ShopHoursLite[] | null) ?? [];
  },
  ['calendar-shop-hours'],
  { revalidate: 300, tags: [SHOP_HOURS_CACHE_TAG] },
);

export const getCachedShopDaysOff = unstable_cache(
  async (shopId: string): Promise<string[]> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseServiceRoleClient() as any;
    const { data } = await admin
      .from('shop_days_off')
      .select('date')
      .eq('shop_id', shopId)
      .order('date', { ascending: true });
    return ((data as Array<{ date: string }> | null) ?? []).map((d) => d.date);
  },
  ['calendar-shop-days-off'],
  { revalidate: 300, tags: [SHOP_DAYS_OFF_CACHE_TAG] },
);
