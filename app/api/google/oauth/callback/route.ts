import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { encrypt, encryptionConfigured } from '@/lib/crypto/aes';
import { exchangeCodeForToken, fetchUserEmail, googleConfigured } from '@/lib/google/server';
import { captureException } from '@/lib/observability';
import { verifyOauthState } from '@/lib/security/oauth-state';

/**
 * Google OAuth callback — Phase 34.
 *
 * Google redirects here with `?code=<one-time>&state=<signed>` after the
 * barber consents. We:
 *   1. Verify the `state` cookie matches what Google echoed back (CSRF
 *      protection).
 *   2. Verify the HMAC signature on the state — proves we minted it
 *      ourselves and it hasn't been tampered with.
 *   3. Verify the state isn't expired.
 *   4. Exchange the `code` for a refresh_token + access_token pair.
 *   5. Look up the user's email via the access_token (display info).
 *   6. Encrypt the refresh_token + upsert into barber_google_calendar.
 *   7. Redirect back to /settings/users with a success flag.
 *
 * Errors redirect back to /settings/users with `?google=error&reason=<tag>`
 * so the UI can surface a toast. We never 500 — a failed connect is a
 * UX problem, not a server problem.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATE_COOKIE = 'kua-google-oauth-state';

// Security audit #8 — state verification moved to lib/security/oauth-state.ts.
// Hard-fails in production when NOTIFICATION_ENCRYPTION_KEY is missing
// rather than silently using a public constant.

function safeRedirect(origin: string, params: Record<string, string>): NextResponse {
  const url = new URL('/fr/settings/users', origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  res.cookies.delete(STATE_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;
  const url = req.nextUrl;
  const errParam = url.searchParams.get('error');
  if (errParam) {
    // User declined the consent screen, or Google returned an error.
    return safeRedirect(origin, { google: 'error', reason: errParam });
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    return safeRedirect(origin, { google: 'error', reason: 'missing_code_or_state' });
  }

  if (!googleConfigured()) {
    return safeRedirect(origin, { google: 'error', reason: 'not_configured' });
  }
  if (!encryptionConfigured()) {
    // We can't safely store the refresh_token without encryption — bail.
    return safeRedirect(origin, { google: 'error', reason: 'encryption_not_configured' });
  }

  // 1. CSRF: state cookie must match query param.
  const cookie = req.cookies.get(STATE_COOKIE)?.value;
  if (!cookie || cookie !== state) {
    return safeRedirect(origin, { google: 'error', reason: 'state_mismatch' });
  }

  // 2. Verify HMAC signature.
  const [payloadB64, sig] = state.split('.');
  if (!payloadB64 || !sig) {
    return safeRedirect(origin, { google: 'error', reason: 'malformed_state' });
  }
  const payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
  if (!verifyOauthState(payload, sig)) {
    return safeRedirect(origin, { google: 'error', reason: 'invalid_signature' });
  }

  // 3. Expiry + extract barberId.
  let parsed: { barberId: string; nonce: string; exp: number };
  try {
    parsed = JSON.parse(payload);
  } catch {
    return safeRedirect(origin, { google: 'error', reason: 'invalid_payload' });
  }
  if (parsed.exp < Math.floor(Date.now() / 1000)) {
    return safeRedirect(origin, { google: 'error', reason: 'state_expired' });
  }
  const barberId = parsed.barberId;

  // 4-7. Exchange + persist.
  try {
    const redirectUri = `${origin}/api/google/oauth/callback`;
    const token = await exchangeCodeForToken({ code, redirectUri });
    if (!token.refresh_token) {
      // Shouldn't happen because we set `prompt=consent` in the start route,
      // but defensive — Google does occasionally omit refresh_token when
      // the user has already granted on a different device recently.
      return safeRedirect(origin, { google: 'error', reason: 'no_refresh_token' });
    }
    const email = (await fetchUserEmail(token.access_token)) ?? 'unknown@google';

    // Find the shop this barber belongs to so we can populate shop_id on
    // the row. The barber_google_calendar table has its own RLS — but the
    // service-role client bypasses it anyway. Defense-in-depth lives in
    // the start route's auth check.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseServiceRoleClient() as any;
    const barberRes = await admin.from('barbers').select('shop_id').eq('id', barberId).single();
    const barber = barberRes.data as { shop_id: string } | null;
    if (!barber) {
      return safeRedirect(origin, { google: 'error', reason: 'barber_not_found' });
    }

    const refreshEnc = encrypt(token.refresh_token);
    await admin.from('barber_google_calendar').upsert(
      {
        shop_id: barber.shop_id,
        barber_id: barberId,
        refresh_token_enc: refreshEnc,
        calendar_id: 'primary',
        sync_status: 'active',
        google_email: email,
        last_synced_at: new Date().toISOString(),
        last_error: null,
      },
      { onConflict: 'barber_id' },
    );

    // Loop 50 (Phase 97) — subscribe the barber's calendar to the
    // events.watch webhook so changes from outside Küa (event added
    // directly in Google Calendar, mobile app, another system)
    // bust our FreeBusy cache instantly. Best-effort: a subscribe
    // failure just leaves us on the 60s polling fallback. The
    // subscribe call needs the row we just upserted, hence the
    // sequential `await` before this point.
    const { subscribeBarberCalendar } = await import('@/lib/google/sync');
    void subscribeBarberCalendar(barberId);

    return safeRedirect(origin, { google: 'connected' });
  } catch (e) {
    captureException(e, { tags: { layer: 'google-oauth', stage: 'callback' } });
    return safeRedirect(origin, { google: 'error', reason: 'unexpected' });
  }
}
