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
 * Uses `getSession()` here on PURPOSE, and ONLY for two non-security jobs:
 * refreshing the access token (writing the rotated cookies onto the response,
 * which a Server Component can't do) and a coarse "no session -> /login" UX
 * redirect. `getSession()` only DECODES the cookie; it does NOT verify the JWT
 * signature (the client holds no signing secret), so middleware is NOT a
 * security gate: a forged cookie passes here but is rejected at the page layer,
 * where `getCurrentUser` revalidates via `getUser()` against the auth server
 * before any role / super-admin decision (AUTHZ-01). Running `getUser()` here
 * too would add ~150ms to every request and double the round-trip on pages
 * that already revalidate.
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

  // getSession() refreshes the access token (rotating cookies onto the
  // response) near expiry. It does NOT verify the JWT signature; the
  // authoritative revalidation is getUser() at the page layer (getCurrentUser).
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return { user: session?.user ?? null, skipped: false as const };
}
