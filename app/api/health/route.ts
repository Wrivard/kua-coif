import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Public health check for uptime monitors (UptimeRobot, Vercel) and load
 * balancers.
 *
 * INT-O3 — the body is deliberately MINIMAL (`{ ok }` only). An anonymous
 * caller must learn nothing about integration configuration (Stripe /
 * webhook-secret presence, Supabase reachability labels, error messages) — that
 * was free reconnaissance. Liveness is carried by the HTTP STATUS instead:
 *   - 200 → the app + data layer are reachable
 *   - 503 → the data layer is down (the signal monitors alert on)
 * Nothing consumes the response body (DEPLOY.md §7: the monitor only checks for
 * a 200). Operators verify integration config via the authenticated settings
 * pages / Vercel env, not this public endpoint.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function health(ok: boolean): NextResponse {
  return NextResponse.json(
    { ok },
    { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}

export async function GET() {
  // No Supabase env (local / preview without a project): the app itself is
  // reachable, so report healthy — without revealing that the env is unset.
  const hasSupabaseEnv = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  if (!hasSupabaseEnv) return health(true);

  try {
    const supabase = createSupabaseServerClient();
    // Cheapest possible ping — getSession reads cookies, doesn't hit the DB or
    // depend on RLS — enough to prove the client constructs and responds.
    await supabase.auth.getSession();
    return health(true);
  } catch {
    // Data layer unreachable → 503 (no error detail leaks to the caller).
    return health(false);
  }
}
