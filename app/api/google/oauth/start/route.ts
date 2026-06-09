import { NextResponse, type NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { getCurrentUser, getShopMemberships } from '@/lib/auth/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { buildOAuthUrl, googleConfigured } from '@/lib/google/server';
import { signOauthState } from '@/lib/security/oauth-state';

// Role ranks for the manager+ gate (matches lib/server-actions/with-action).
const ROLE_RANK = { owner: 3, manager: 2, barber: 1 } as const;

/**
 * Kick off the per-barber Google Calendar OAuth flow — Phase 34.
 *
 * Flow:
 *   1. Client navigates to /api/google/oauth/start?barber_id=<uuid>
 *   2. We verify the caller is authenticated AND a member of the shop
 *      that owns the barber (defense-in-depth on top of the upstream
 *      RLS check).
 *   3. We pack `{barberId, nonce, exp}` into a signed cookie + matching
 *      state string. Google sends `state` back unchanged on the callback
 *      so we can verify it wasn't tampered with.
 *   4. We redirect to Google's consent screen.
 *
 * Why a separate route instead of a Server Action: Server Actions can't
 * return a redirect to a 3rd-party domain (Next.js gates redirects to
 * the same-origin allowlist). A plain GET handler that returns 302 is
 * the simplest path.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATE_COOKIE = 'kua-google-oauth-state';
const STATE_TTL_SEC = 10 * 60; // 10 minutes — generous for slow consent screens.

// Security audit #8 — state signing moved to lib/security/oauth-state.ts
// which hard-fails in production when NOTIFICATION_ENCRYPTION_KEY is
// missing (previous local helper fell back to a public constant — CSRF
// hole if env was misconfigured). Same NOTIFICATION_ENCRYPTION_KEY reused
// for the HMAC: any deploy that has Google Connect activated will already
// have it for SMTP encryption (Phase 25).
const signState = signOauthState;

export async function GET(req: NextRequest) {
  if (!googleConfigured()) {
    return NextResponse.json({ error: 'google_not_configured' }, { status: 404 });
  }

  // 1. Auth + membership check.
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const memberships = await getShopMemberships();
  if (memberships.length === 0) {
    return NextResponse.json({ error: 'no_shop' }, { status: 403 });
  }

  const barberId = req.nextUrl.searchParams.get('barber_id');
  if (!barberId) {
    return NextResponse.json({ error: 'missing_barber_id' }, { status: 400 });
  }

  // SECURITY (Barbers audit B3) — authorize the barber_id, don't just trust it.
  // Pre-fix this route checked only "member of SOME shop", so a member of shop
  // A could start OAuth for shop B's barber and bind B's chair to their own
  // Google account (exfiltrating B's client PII into a stranger's calendar).
  // The user-session client's RLS (is_shop_member) returns the barber ONLY if
  // the caller is a member of its shop; we then additionally require manager+
  // in that shop (connecting a calendar is a manager action).
  const supabase = createSupabaseServerClient();
  const barberRes = await supabase
    .from('barbers')
    .select('shop_id')
    .eq('id', barberId)
    .maybeSingle();
  const barber = barberRes.data as { shop_id: string } | null;
  if (!barber) {
    // No such barber, or the caller isn't a member of its shop (RLS-filtered).
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const membership = memberships.find((m) => m.shop_id === barber.shop_id);
  if (!membership || (ROLE_RANK[membership.role] ?? 0) < ROLE_RANK.manager) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // 2. Build the signed state. `nonce` adds entropy so the same barberId
  //    can't be replayed across sessions; `exp` caps how long the consent
  //    URL is valid.
  const nonce = randomBytes(16).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + STATE_TTL_SEC;
  const payload = JSON.stringify({ barberId, nonce, exp });
  const sig = signState(payload);
  const state = Buffer.from(payload).toString('base64url') + '.' + sig;

  // 3. Build the Google consent URL.
  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/google/oauth/callback`;
  const url = buildOAuthUrl({ state, redirectUri });

  // 4. Persist the signed state in a cookie too — defense-in-depth. The
  //    callback verifies BOTH the cookie and the state param match (CSRF
  //    protection beyond signature alone).
  const response = NextResponse.redirect(url);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: STATE_TTL_SEC,
    path: '/',
  });
  return response;
}
