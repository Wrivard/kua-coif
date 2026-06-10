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
 * a shop's members. The appointment/blocked/barber reads stay on the live RLS
 * client; only this static config is cached.
 *
 * Service-role client + explicit `shop_id` scope — service-role bypasses RLS,
 * so the shop filter is REQUIRED for tenant isolation; the caller
 * (`requireShopMember` in the page) has already proven membership before we
 * key by shopId.
 *
 * Tags are SHOP-SCOPED (`${tag}:${shopId}`) so a config edit in one shop only
 * busts that shop's entry — a global tag would invalidate every tenant's
 * cache on any shop's edit (audit #12). 5-minute TTL is the fallback; the
 * mutating Server Actions call `revalidateShopConfig(shopId)`
 * (lib/server-actions/revalidate.ts) so edits show immediately.
 */
export const SERVICES_CACHE_TAG = 'services';
export const SERVICE_CATEGORIES_CACHE_TAG = 'service-categories';
export const SHOP_HOURS_CACHE_TAG = 'shop-hours';
export const SHOP_DAYS_OFF_CACHE_TAG = 'shop-days-off';
export const BARBER_SETTINGS_CACHE_TAG = 'barber-settings';
export const BOOKABLE_BARBERS_CACHE_TAG = 'bookable-barbers';

/**
 * The shop-scoped (shopId-keyed) cache tags for a shop's calendar/booking
 * config. `revalidateShopConfig(shopId)` busts them all. The booking slots
 * route (plan 017) added barber-settings + bookable-barbers here, so the
 * barbers CRUD + save_barber_settings actions that mutate those tables now
 * call `revalidateShopConfig` too.
 */
export function shopConfigCacheTags(shopId: string): string[] {
  return [
    `${SERVICES_CACHE_TAG}:${shopId}`,
    `${SERVICE_CATEGORIES_CACHE_TAG}:${shopId}`,
    `${SHOP_HOURS_CACHE_TAG}:${shopId}`,
    `${SHOP_DAYS_OFF_CACHE_TAG}:${shopId}`,
    `${BARBER_SETTINGS_CACHE_TAG}:${shopId}`,
    `${BOOKABLE_BARBERS_CACHE_TAG}:${shopId}`,
  ];
}

/**
 * Alias-keyed cache tag for `getCachedShopByAlias`. Deliberately NOT part of
 * `shopConfigCacheTags` (that helper is shopId-keyed): the shop-by-alias entry
 * is keyed by the public booking slug, not the shop id. A mutation that changes
 * a shop's alias / timezone / allow_booking_any_barber must bust THIS tag
 * explicitly — `revalidatePublicShopSurfaces(alias)` does so.
 */
export const SHOP_ALIAS_CACHE_TAG = 'shop-alias';
export function shopAliasCacheTag(alias: string): string {
  return `${SHOP_ALIAS_CACHE_TAG}:${alias}`;
}

export type ShopHoursLite = {
  weekday: number;
  enabled: boolean;
  open_time: string | null;
  close_time: string | null;
};

export function getCachedServices(shopId: string): Promise<ServiceRow[]> {
  return unstable_cache(
    async (): Promise<ServiceRow[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createSupabaseServiceRoleClient() as any;
      const { data } = await admin
        .from('services')
        .select('*')
        .eq('shop_id', shopId)
        .order('sort_order', { ascending: true });
      return (data as ServiceRow[] | null) ?? [];
    },
    ['calendar-services', shopId],
    { revalidate: 300, tags: [`${SERVICES_CACHE_TAG}:${shopId}`] },
  )();
}

export function getCachedServiceCategories(shopId: string): Promise<ServiceCategoryRow[]> {
  return unstable_cache(
    async (): Promise<ServiceCategoryRow[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createSupabaseServiceRoleClient() as any;
      const { data } = await admin
        .from('service_categories')
        .select('*')
        .eq('shop_id', shopId)
        .order('sort_order', { ascending: true });
      return (data as ServiceCategoryRow[] | null) ?? [];
    },
    ['calendar-service-categories', shopId],
    { revalidate: 300, tags: [`${SERVICE_CATEGORIES_CACHE_TAG}:${shopId}`] },
  )();
}

export function getCachedShopHours(shopId: string): Promise<ShopHoursLite[]> {
  return unstable_cache(
    async (): Promise<ShopHoursLite[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createSupabaseServiceRoleClient() as any;
      const { data } = await admin
        .from('shop_hours')
        .select('weekday, enabled, open_time, close_time')
        .eq('shop_id', shopId)
        .order('weekday', { ascending: true });
      return (data as ShopHoursLite[] | null) ?? [];
    },
    ['calendar-shop-hours', shopId],
    { revalidate: 300, tags: [`${SHOP_HOURS_CACHE_TAG}:${shopId}`] },
  )();
}

export function getCachedShopDaysOff(shopId: string): Promise<string[]> {
  return unstable_cache(
    async (): Promise<string[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createSupabaseServiceRoleClient() as any;
      const { data } = await admin
        .from('shop_days_off')
        .select('date')
        .eq('shop_id', shopId)
        .order('date', { ascending: true });
      return ((data as Array<{ date: string }> | null) ?? []).map((d) => d.date);
    },
    ['calendar-shop-days-off', shopId],
    { revalidate: 300, tags: [`${SHOP_DAYS_OFF_CACHE_TAG}:${shopId}`] },
  )();
}

export type ShopByAliasLite = {
  id: string;
  timezone: string;
  allow_booking_any_barber: boolean;
};

/**
 * The shops projection the public slots route resolves from the URL slug.
 * Alias-keyed (the public booking surface only knows the slug), so the cache
 * key includes the alias and the tag is `shop-alias:${alias}` — busted by
 * `revalidatePublicShopSurfaces(alias)` when a shop's alias / timezone /
 * allow_booking_any_barber changes. Returns null when no shop matches the slug
 * (the route 404s). Matches the route's original `.eq('alias', …).limit(1)`.
 */
export function getCachedShopByAlias(alias: string): Promise<ShopByAliasLite | null> {
  return unstable_cache(
    async (): Promise<ShopByAliasLite | null> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createSupabaseServiceRoleClient() as any;
      const { data } = await admin
        .from('shops')
        .select('id, timezone, allow_booking_any_barber')
        .eq('alias', alias)
        .limit(1);
      return ((data as ShopByAliasLite[] | null) ?? [])[0] ?? null;
    },
    ['calendar-shop-by-alias', alias],
    { revalidate: 300, tags: [shopAliasCacheTag(alias)] },
  )();
}

export type BarberSettingsLite = {
  scope: 'shop' | 'barber';
  barber_id: string | null;
  client_booking_interval_min: number;
  days_book_in_advance: number;
  mins_book_before_appt: number;
};

/**
 * The `barber_settings` columns the slots route reads to resolve the booking
 * interval + lead-time window (shop-default row + per-barber overrides).
 * Tag `barber-settings:${shopId}` — busted by `revalidateShopConfig` from the
 * save_barber_settings action.
 */
export function getCachedBarberSettings(shopId: string): Promise<BarberSettingsLite[]> {
  return unstable_cache(
    async (): Promise<BarberSettingsLite[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createSupabaseServiceRoleClient() as any;
      const { data } = await admin
        .from('barber_settings')
        .select(
          'scope, barber_id, client_booking_interval_min, days_book_in_advance, mins_book_before_appt',
        )
        .eq('shop_id', shopId);
      return (data as BarberSettingsLite[] | null) ?? [];
    },
    ['calendar-barber-settings', shopId],
    { revalidate: 300, tags: [`${BARBER_SETTINGS_CACHE_TAG}:${shopId}`] },
  )();
}

export type BookableBarberLite = { id: string; sort_order: number };

/**
 * Confirmed + bookable barbers (id + sort_order, sort-order ascending) — the
 * slots route's "pick first for `any`" source AND its explicit-barber
 * validation list (membership = bookable in this shop). Tag
 * `bookable-barbers:${shopId}` — busted by `revalidateShopConfig` from the
 * barbers CRUD + bookable-toggle actions.
 */
export function getCachedBookableBarbers(shopId: string): Promise<BookableBarberLite[]> {
  return unstable_cache(
    async (): Promise<BookableBarberLite[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createSupabaseServiceRoleClient() as any;
      const { data } = await admin
        .from('barbers')
        .select('id, sort_order')
        .eq('shop_id', shopId)
        .eq('status', 'confirmed')
        .eq('bookable', true)
        .order('sort_order', { ascending: true });
      return (data as BookableBarberLite[] | null) ?? [];
    },
    ['calendar-bookable-barbers', shopId],
    { revalidate: 300, tags: [`${BOOKABLE_BARBERS_CACHE_TAG}:${shopId}`] },
  )();
}
