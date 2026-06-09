import { revalidatePath, revalidateTag } from 'next/cache';
import { SHOP_CACHE_TAG } from '@/lib/auth/server';
import {
  SERVICES_CACHE_TAG,
  SERVICE_CATEGORIES_CACHE_TAG,
  SHOP_HOURS_CACHE_TAG,
  SHOP_DAYS_OFF_CACHE_TAG,
} from '@/lib/data/calendar-config';

/**
 * Bust the cache on every public surface that may be reading a shop's
 * displayable config (hours, services, barbers, widget theme, etc.).
 *
 * Background:
 *   `/book/[shopSlug]` and `/embed/[shopSlug]` ship with `revalidate = 60`, so
 *   they're served from the RSC cache for up to a minute. That's fine for a
 *   normal client visit but not for the admin who just edited a service and
 *   wants to verify the booking page reflects it. This helper, called from
 *   the relevant Server Actions, invalidates the cached output immediately.
 *
 *   We use the route-pattern form (`'/[locale]/book/[shopSlug]'`) with the
 *   `'page'` scope so EVERY locale and shopSlug instance of the route is
 *   purged in one call — no need to look up the shop alias from `ctx.shopId`.
 *
 * Cheap to call: invalidating a page that wasn't cached is a no-op.
 */
export function revalidatePublicShopSurfaces() {
  revalidatePath('/[locale]/book/[shopSlug]', 'page');
  revalidatePath('/[locale]/embed/[shopSlug]', 'page');
}

/**
 * Bust the `unstable_cache` entry for the shop row (id/name/timezone/industry).
 * Call from any Server Action that mutates `shops` so the next page render
 * picks up the change immediately instead of waiting up to 60s for the
 * TTL-based revalidation.
 */
export function revalidateShopRow() {
  revalidateTag(SHOP_CACHE_TAG);
}

/**
 * Bust the `unstable_cache` entries for a shop's calendar config
 * (services / categories / hours / days-off — see lib/data/calendar-config).
 * Call from any Server Action that edits that config so the calendar + booking
 * surfaces pick the change up immediately instead of after the 5-minute TTL.
 *
 * Busts all four tags regardless of which table changed: the tables are tiny
 * and a `revalidateTag` on an entry that wasn't actually cached is a cheap
 * no-op, so over-busting costs nothing and removes the risk of forgetting a
 * specific tag at a given call site.
 */
export function revalidateShopConfig() {
  revalidateTag(SERVICES_CACHE_TAG);
  revalidateTag(SERVICE_CATEGORIES_CACHE_TAG);
  revalidateTag(SHOP_HOURS_CACHE_TAG);
  revalidateTag(SHOP_DAYS_OFF_CACHE_TAG);
}
