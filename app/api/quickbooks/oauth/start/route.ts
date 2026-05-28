import { NextResponse, type NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { getCurrentShopId, getCurrentUser } from '@/lib/auth/server';
import { buildQbOAuthUrl, quickbooksConfigured } from '@/lib/quickbooks/server';
import { signOauthState } from '@/lib/security/oauth-state';

/**
 * Kick off the QuickBooks OAuth flow — Phase 35.
 *
 * Shop-scoped (unlike Google Calendar which is per-barber). One shop
 * connects one QuickBooks company; future charges flow into THAT
 * company's books.
 *
 * Same signed-state-cookie + HMAC pattern as the Google start route —
 * we reuse NOTIFICATION_ENCRYPTION_KEY for the HMAC secret so there's
 * no new env var to introduce.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATE_COOKIE = 'kua-qb-oauth-state';
const STATE_TTL_SEC = 10 * 60;

// Security audit #8 — see google/oauth/start. Local helper now delegates
// to the shared lib which hard-fails in production on missing env.
const signState = signOauthState;

export async function GET(req: NextRequest) {
  if (!quickbooksConfigured()) {
    return NextResponse.json({ error: 'quickbooks_not_configured' }, { status: 404 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const shopId = await getCurrentShopId();
  if (!shopId) {
    return NextResponse.json({ error: 'no_shop' }, { status: 403 });
  }

  const nonce = randomBytes(16).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + STATE_TTL_SEC;
  const payload = JSON.stringify({ shopId, nonce, exp });
  const sig = signState(payload);
  const state = Buffer.from(payload).toString('base64url') + '.' + sig;

  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/quickbooks/oauth/callback`;
  const url = buildQbOAuthUrl({ state, redirectUri });

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
