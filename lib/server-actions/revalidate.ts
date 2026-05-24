import { revalidatePath } from 'next/cache';

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
