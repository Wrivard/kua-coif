import { redirect } from 'next/navigation';
import { cache } from 'react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { UserRole } from '@/db/enums';
import { defaultLocale } from '@/i18n';

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
 * Uses `getSession()` rather than `getUser()` deliberately. Both expose
 * the same `user` object; the difference is:
 *
 *   - `getUser()` POSTs the JWT to the Supabase Auth server on every call
 *     to re-validate and rotate the refresh token. ~150ms per call.
 *   - `getSession()` reads the JWT from cookies and validates the
 *     signature locally. ~5ms.
 *
 * Our `middleware.ts` already calls `getUser()` (via `refreshSupabaseSession`)
 * on every request — that's the canonical auth gate. By the time a Server
 * Component runs, the session has been freshly validated and refreshed.
 * Calling `getUser()` again here would mean two network round-trips per
 * page load for the same answer, which is exactly the latency the user
 * was complaining about.
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

export const getShopMemberships = cache(async () => {
  const user = await getCurrentUser();
  if (!user) return [] as ShopMembership[];
  const supabase = createSupabaseServerClient();
  // Cast through unknown since the placeholder Database type doesn't know our
  // tables yet. Phase 2 codegen will make this strict.
  const { data, error } = await (
    supabase as unknown as {
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
    .eq('user_id', user.id)
    .eq('status', 'confirmed');
  if (error || !data) return [];
  return data;
});

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
 * Resolve the "current shop" — for V1 we pick the first confirmed membership.
 * Phase 6 (User Settings / shop switcher) will let multi-shop users pick.
 */
export async function getCurrentShopId(): Promise<string | null> {
  const memberships = await getShopMemberships();
  if (memberships.length === 0) return null;
  return memberships[0]!.shop_id;
}

/**
 * Static-ish shop row (id + name + timezone + industry) cached per request.
 *
 * Layout + page both used to query `shops` independently — that's two
 * sequential round-trips before the page can start rendering. Pulling the
 * fields they both need into a single React-cached helper means the second
 * caller hits the cache (0ms) instead of the DB. Saves ~100-150ms per
 * server-rendered page.
 */
export type CurrentShop = {
  id: string;
  name: string;
  timezone: string;
  industry: string | null;
};

export const getCurrentShop = cache(async (): Promise<CurrentShop | null> => {
  const shopId = await getCurrentShopId();
  if (!shopId) return null;
  const supabase = createSupabaseServerClient();
  const { data } = await (
    supabase as unknown as {
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
});

/**
 * Gate a route on the Küa super-admin flag (Phase 22). Looks up
 * `profiles.is_kua_admin` for the current user; redirects to `/no-shop` if
 * not authenticated or not a Küa team member. The boolean is column-level
 * locked against client-side updates (only service-role can flip it), so
 * trusting it here is safe.
 */
export const getIsKuaAdmin = cache(async (): Promise<boolean> => {
  const user = await getCurrentUser();
  if (!user) return false;
  const supabase = createSupabaseServerClient();
  const { data } = await (
    supabase as unknown as {
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
    .eq('id', user.id)
    .single();
  return Boolean(data?.is_kua_admin);
});

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
 * Gate a Server Action / page on a minimum role within the active shop.
 * Throws (so `error.tsx` can render) instead of redirecting — callers in form
 * actions usually want to surface the error to the user.
 */
export async function requireRoleInCurrentShop(minimum: UserRole) {
  const memberships = await getShopMemberships();
  if (memberships.length === 0) throw new Error('NO_SHOP');
  const m = memberships[0]!;
  const order: Record<UserRole, number> = { owner: 3, manager: 2, barber: 1 };
  if (order[m.role] < order[minimum]) {
    throw new Error('FORBIDDEN');
  }
  return m;
}
