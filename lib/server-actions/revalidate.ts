import { revalidatePath, revalidateTag } from 'next/cache';
import { SHOP_CACHE_TAG } from '@/lib/auth/server';
import { shopConfigCacheTags, shopAliasCacheTag } from '@/lib/data/calendar-config';

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
 * Granularity (plan 017):
 *   - WITH a `shopAlias`: purge ONLY that shop's public ISR — both locales of
 *     /book and /embed (literal paths) — AND bust its alias-keyed config cache
 *     (`getCachedShopByAlias`, used by the slots route). Preferred: a one-shop
 *     edit no longer purges every tenant's booking page.
 *   - WITHOUT an alias (caller only holds `ctx.shopId`, not the slug): fall
 *     back to the route-pattern purge of EVERY tenant's /book + /embed. Coarser
 *     but correct; the alias-keyed shop cache can't be busted here, so it
 *     relies on its 300s TTL for those callers.
 *
 * Cheap to call: invalidating a page that wasn't cached is a no-op.
 */
export function revalidatePublicShopSurfaces(shopAlias?: string) {
  if (shopAlias) {
    revalidatePath(`/fr/book/${shopAlias}`, 'page');
    revalidatePath(`/en/book/${shopAlias}`, 'page');
    revalidatePath(`/fr/embed/${shopAlias}`, 'page');
    revalidatePath(`/en/embed/${shopAlias}`, 'page');
    revalidateTag(shopAliasCacheTag(shopAlias));
    return;
  }
  // Fallback: alias not in reach — global, every-tenant purge.
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
 * Bust the `unstable_cache` entries for ONE shop's calendar config
 * (services / categories / hours / days-off — see lib/data/calendar-config).
 * Call from any Server Action that edits that config, passing the active
 * shop id, so the calendar + booking surfaces pick the change up immediately
 * instead of after the 5-minute TTL.
 *
 * The tags are shop-scoped (`${tag}:${shopId}`), so this busts only the
 * editing shop's cache — a global tag would invalidate every tenant's config
 * cache on any one shop's edit (audit #12). Busts all four of the shop's tags
 * regardless of which table changed: they're tiny and a `revalidateTag` on an
 * uncached entry is a cheap no-op, so over-busting within the shop costs
 * nothing and removes the risk of forgetting a specific tag.
 */
export function revalidateShopConfig(shopId: string) {
  for (const tag of shopConfigCacheTags(shopId)) revalidateTag(tag);
}
