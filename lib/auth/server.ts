import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import type { UserRole } from '@/db/enums';
import { defaultLocale } from '@/i18n';

/**
 * Phase 65 — cookie name that holds the user's currently-selected shop.
 * The shop switcher in the sidebar writes this via the `selectShop`
 * server action. `getCurrentShopId` reads it and validates against the
 * user's memberships before trusting the value.
 */
export const SHOP_COOKIE = 'kua_active_shop';

/**
 * Server-side auth helpers. All are pure async functions usable from Server
 * Components, Server Actions, Route Handlers, and `generateMetadata`.
 *
 * `cache()` dedupes repeated calls within the same request (e.g. layout reads
 * the user, page reads the user — only one round-trip to Supabase).
 */

/**
 * Resolve the current user from the request cookies.
 *
 * Uses `getSession()` (not `getUser()`) — `getSession()` parses the JWT
 * from cookies and validates its signature locally (~5ms), only making
 * a network call when the access token is expired (auto-refresh).
 * `getUser()` always POSTs to /auth/v1/user (~150ms) which would be
 * paid on every server render.
 *
 * Security: the JWT is signed with Supabase's project secret which only
 * Supabase and our server know. A forged token fails signature check;
 * a valid token grants access until its `exp` claim. For our threat model
 * (salon SaaS, no remote-revoke flow) this is sufficient.
 *
 * Wrapped in React `cache()` so multiple components in the same render
 * (layout + page + nested server components) share a single read of the
 * cookie store.
 */
export const getCurrentUser = cache(async () => {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;
  return data.session.user;
});

/**
 * Force the caller to be authenticated. Redirects to /login with a `redirect`
 * query param so we can come back here after sign-in.
 */
export async function requireUser(opts?: { locale?: string; redirectTo?: string }) {
  const user = await getCurrentUser();
  if (user) return user;
  const locale = opts?.locale ?? defaultLocale;
  const redirectTo = opts?.redirectTo ? `?redirect=${encodeURIComponent(opts.redirectTo)}` : '';
  redirect(`/${locale}/login${redirectTo}`);
}

/**
 * The shape we expose to callers: a Supabase user + their shop memberships.
 */
export type ShopMembership = {
  shop_id: string;
  role: UserRole;
  status: 'confirmed' | 'staff' | 'deleted';
};

const MEMBERSHIPS_CACHE_TAG = 'memberships';

/**
 * Cross-request cache of a user's confirmed memberships (60s TTL), keyed by
 * user id — mirrors `getCachedShopRow`. Removes an uncached `shop_members`
 * SELECT from every authenticated page load (was React-`cache()`-only =
 * deduped within a request but re-queried on every new request). Service-
 * role client so the cached query is request-independent; safe because it's
 * scoped to the validated user's own rows. Staleness ≤60s; bust sooner via
 * `revalidateTag('memberships')` from membership-mutating actions.
 */
const getCachedMemberships = unstable_cache(
  async (userId: string): Promise<ShopMembership[]> => {
    const admin = createSupabaseServiceRoleClient();
    const { data } = await (
      admin as unknown as {
        from: (t: string) => {
          select: (cols: string) => {
            eq: (
              k: string,
              v: string,
            ) => {
              eq: (
                k: string,
                v: string,
              ) => Promise<{ data: ShopMembership[] | null; error: unknown }>;
            };
          };
        };
      }
    )
      .from('shop_members')
      .select('shop_id, role, status')
      .eq('user_id', userId)
      .eq('status', 'confirmed');
    return data ?? [];
  },
  ['shop-memberships'],
  { revalidate: 60, tags: [MEMBERSHIPS_CACHE_TAG] },
);

export const getShopMemberships = cache(async () => {
  const user = await getCurrentUser();
  if (!user) return [] as ShopMembership[];
  return getCachedMemberships(user.id);
});

/** Re-export so Server Actions can bust the memberships cache on mutations. */
export { MEMBERSHIPS_CACHE_TAG };

/**
 * Require the current user to be a confirmed member of *some* shop. If they
 * have none, send them to the onboarding flow (Phase 9). For now we redirect
 * to a "no shop" page that doesn't exist yet — middleware will surface a 404
 * which is acceptable for the design system phase.
 */
export async function requireShopMember(opts?: { locale?: string }) {
  const user = await requireUser({ locale: opts?.locale });
  const memberships = await getShopMemberships();
  if (memberships.length === 0) {
    redirect(`/${opts?.locale ?? defaultLocale}/no-shop`);
  }
  return { user, memberships };
}

/**
 * Resolve the "current shop" — Phase 65 cookie-aware version.
 *
 * Reads `SHOP_COOKIE` from the request cookies. If the cookie names a
 * shop the user is still a confirmed member of, that's the active shop.
 * If the cookie is missing or names a shop they no longer belong to
 * (membership revoked, account deleted, etc.), fall back to the first
 * membership — same behavior as before Phase 65.
 *
 * The cookie is set by the `selectShop` server action and cleared on
 * sign-out by the existing Supabase Auth cookie reset.
 */
export async function getCurrentShopId(): Promise<string | null> {
  const memberships = await getShopMemberships();
  if (memberships.length === 0) return null;
  const cookieShopId = cookies().get(SHOP_COOKIE)?.value;
  if (cookieShopId && memberships.some((m) => m.shop_id === cookieShopId)) {
    return cookieShopId;
  }
  return memberships[0]!.shop_id;
}

/**
 * Static-ish shop row (id + name + timezone + industry).
 *
 * Cached in two layers:
 *  1. **Cross-request** via `unstable_cache` keyed by shop_id (Vercel Data
 *     Cache, 60s TTL). Identical reads from different requests within the
 *     same minute reuse the cached value — saves the Postgres round-trip
 *     entirely on the hot path. Bust the cache via `revalidateTag('shop')`
 *     in any Server Action that mutates the shop row.
 *  2. **Within a single request** via React `cache()` so layout + page +
 *     nested components share one resolution even on cache miss.
 *
 * Uses the service-role client so the cached query bypasses RLS (cheaper,
 * one less JWT validation per call). Safe because the caller has already
 * proven membership via `getCurrentShopId()` before we cache-key by shop_id.
 */
export type CurrentShop = {
  id: string;
  name: string;
  timezone: string;
  industry: string | null;
};

const SHOP_CACHE_TAG = 'shop';

const getCachedShopRow = unstable_cache(
  async (shopId: string): Promise<CurrentShop | null> => {
    const admin = createSupabaseServiceRoleClient();
    const { data } = await (
      admin as unknown as {
        from: (t: string) => {
          select: (cols: string) => {
            eq: (
              k: string,
              v: string,
            ) => {
              single: () => Promise<{ data: CurrentShop | null; error: unknown }>;
            };
          };
        };
      }
    )
      .from('shops')
      .select('id, name, timezone, industry')
      .eq('id', shopId)
      .single();
    return data ?? null;
  },
  ['shop-row'],
  { revalidate: 60, tags: [SHOP_CACHE_TAG] },
);

export const getCurrentShop = cache(async (): Promise<CurrentShop | null> => {
  const shopId = await getCurrentShopId();
  if (!shopId) return null;
  return getCachedShopRow(shopId);
});

/** Re-export so Server Actions can bust the shop cache on mutations. */
export { SHOP_CACHE_TAG };

/**
 * Gate a route on the Küa super-admin flag (Phase 22). Looks up
 * `profiles.is_kua_admin` for the current user; redirects to `/no-shop` if
 * not authenticated or not a Küa team member. The boolean is column-level
 * locked against client-side updates (only service-role can flip it), so
 * trusting it here is safe.
 */
const KUA_ADMIN_CACHE_TAG = 'kua-admin';

/**
 * Cross-request cache of the Küa super-admin flag (60s TTL), keyed by user
 * id — mirrors `getCachedShopRow`. Removes an uncached `profiles` SELECT
 * from every authenticated page load. Service-role client (request-
 * independent; the flag is column-locked against client writes). Staleness
 * ≤60s; bust via `revalidateTag('kua-admin')` if a flag flips.
 */
const getCachedIsKuaAdmin = unstable_cache(
  async (userId: string): Promise<boolean> => {
    const admin = createSupabaseServiceRoleClient();
    const { data } = await (
      admin as unknown as {
        from: (t: string) => {
          select: (cols: string) => {
            eq: (
              k: string,
              v: string,
            ) => {
              single: () => Promise<{
                data: { is_kua_admin: boolean } | null;
                error: unknown;
              }>;
            };
          };
        };
      }
    )
      .from('profiles')
      .select('is_kua_admin')
      .eq('id', userId)
      .single();
    return Boolean(data?.is_kua_admin);
  },
  ['is-kua-admin'],
  { revalidate: 60, tags: [KUA_ADMIN_CACHE_TAG] },
);

export const getIsKuaAdmin = cache(async (): Promise<boolean> => {
  const user = await getCurrentUser();
  if (!user) return false;
  return getCachedIsKuaAdmin(user.id);
});

/** Re-export so Server Actions can bust the admin-flag cache on mutations. */
export { KUA_ADMIN_CACHE_TAG };

export async function requireKuaAdmin(opts?: { locale?: string }) {
  const user = await requireUser({ locale: opts?.locale });
  const isAdmin = await getIsKuaAdmin();
  if (!isAdmin) {
    // We bounce non-admins to /no-shop rather than throwing — keeps the URL
    // discoverable without leaking that the admin section exists.
    redirect(`/${opts?.locale ?? defaultLocale}/no-shop`);
  }
  return user;
}

/**
 * Phase H+5 — resolve the `barbers.id` row for the currently-signed-in user
 * in the active shop. Returns null when:
 *   - no user (unauthenticated)
 *   - no active shop
 *   - user is signed in but has no barber row (e.g. owner / manager who
 *     never carries appointments themselves)
 *
 * Used by the `withAction` wrapper to populate `ctx.barberId`, which the
 * appointment/clients mutation actions use to enforce "barber can only
 * touch their own work" ownership checks.
 *
 * Cached at the React-request level so a single render that touches
 * several actions doesn't re-query.
 */
export const getCurrentBarberId = cache(async (): Promise<string | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const shopId = await getCurrentShopId();
  if (!shopId) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createSupabaseServiceRoleClient() as any;
  const res = await sb
    .from('barbers')
    .select('id')
    .eq('user_id', user.id)
    .eq('shop_id', shopId)
    .maybeSingle();
  return (res.data as { id: string } | null)?.id ?? null;
});

/**
 * Gate a Server Action / page on a minimum role within the active shop.
 * Throws (so `error.tsx` can render) instead of redirecting — callers in form
 * actions usually want to surface the error to the user.
 *
 * Security audit #2 (CRITICAL) — cookie-aware membership lookup.
 *
 * Pre-fix, this pinned `memberships[0]` regardless of the active-shop
 * cookie. A multi-shop user (e.g. `owner` in shop A, `barber` in shop
 * B) who flipped the cookie to shop B would have their owner role
 * SILENTLY APPLIED against shop B's pages — `/finances`,
 * `/marketing/*`, `/settings/audit-log`, `/settings/notifications`,
 * `testSmtpConnection`, `testTwilioConfig`, `upload-actions.ts`.
 * Cookie was validated for the data layer via `getCurrentShopId()`
 * but the role gate ignored it. Same bug class as the `withAction`
 * fix in commit 4227721 — this surface never got it.
 *
 * Fix: read `getCurrentShopId()` (which validates the cookie against
 * memberships) and look up the membership for THAT shop_id. Falls
 * back to `memberships[0]` for single-shop users.
 */
export async function requireRoleInCurrentShop(minimum: UserRole) {
  const memberships = await getShopMemberships();
  if (memberships.length === 0) throw new Error('NO_SHOP');
  const activeShopId = await getCurrentShopId();
  const m = memberships.find((row) => row.shop_id === activeShopId) ?? memberships[0]!;
  const order: Record<UserRole, number> = { owner: 3, manager: 2, barber: 1 };
  if (order[m.role] < order[minimum]) {
    throw new Error('FORBIDDEN');
  }
  return m;
}
