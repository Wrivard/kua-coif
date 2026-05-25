import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { NextRequest, NextResponse } from 'next/server';
import type { Database } from '@/db/types';

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Refresh the Supabase session for the incoming request and mirror updated
 * cookies into the response we will return. Returns the user (or null) so the
 * top-level middleware can apply auth-gating redirects.
 *
 * If Supabase env vars are missing (e.g. local dev without a project yet) we
 * skip silently — the app stays usable for the design system / kitchen-sink.
 *
 * Uses `getSession()` rather than `getUser()` for performance. `getUser()`
 * POSTs the JWT to /auth/v1/user on every request (~150ms network round-trip
 * to validate against the auth server, including revocation check).
 * `getSession()` reads the JWT from cookies and validates the signature
 * locally (~5ms), and only makes a network call when the access token is
 * actually expired (triggers a refresh).
 *
 * Trade-off: we no longer detect server-side token revocation in middleware.
 * For our threat model (salon SaaS, no admin remote-revoke flow), this is
 * acceptable — the access token's natural 1h expiry plus signed-out cookies
 * being cleared client-side cover the realistic invalidation paths.
 */
export async function refreshSupabaseSession(request: NextRequest, response: NextResponse) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return { user: null, skipped: true as const };
  }

  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value, options }) => {
          // Mirror the cookie change onto BOTH the request (so subsequent
          // middleware reads see the new value) and the response (so the
          // browser persists it).
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // getSession() reads cookies, validates JWT signature locally, and only
  // makes a network call when the access token is expired (auto-refresh).
  // ~5ms on the hot path vs ~150ms for getUser().
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return { user: session?.user ?? null, skipped: false as const };
}
