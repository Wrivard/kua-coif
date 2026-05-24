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

  // getUser() touches the auth server and rotates the refresh token if needed.
  // This is the canonical "keep the session alive" call in @supabase/ssr.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { user, skipped: false as const };
}
