import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Health check for monitoring services (UptimeRobot, Vercel, custom alerts).
 *
 * Returns:
 *   200 { ok: true,  uptime, supabase: 'ok' | 'skipped', timestamp }
 *   503 { ok: false, uptime, supabase: 'error', error, timestamp }
 *
 * `supabase: 'skipped'` means env vars aren't configured (local dev without
 * a project) — the app itself is reachable but the data layer can't be
 * verified. Monitoring should alert on `503` only.
 *
 * No PII, no shop data, no sensitive details — safe to expose publicly.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const startedAt = Date.now();
  const hasSupabaseEnv = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );

  if (!hasSupabaseEnv) {
    return NextResponse.json(
      {
        ok: true,
        supabase: 'skipped',
        uptimeMs: Math.round(process.uptime() * 1000),
        timestamp: new Date().toISOString(),
      },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  }

  try {
    const supabase = createSupabaseServerClient();
    // Cheapest possible ping — auth's getSession reads cookies but does NOT
    // hit the database, so it's fast and doesn't depend on RLS being open.
    await supabase.auth.getSession();
    return NextResponse.json(
      {
        ok: true,
        supabase: 'ok',
        latencyMs: Date.now() - startedAt,
        uptimeMs: Math.round(process.uptime() * 1000),
        timestamp: new Date().toISOString(),
      },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        supabase: 'error',
        error: err instanceof Error ? err.message : 'unknown',
        latencyMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
