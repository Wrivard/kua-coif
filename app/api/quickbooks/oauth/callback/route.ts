import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { encrypt, encryptionConfigured } from '@/lib/crypto/aes';
import { exchangeQbCode, quickbooksConfigured } from '@/lib/quickbooks/server';
import { captureException } from '@/lib/observability';
import { verifyOauthState } from '@/lib/security/oauth-state';

/**
 * QuickBooks OAuth callback â€” Phase 35.
 *
 * Intuit redirects with `?code=...&state=...&realmId=...`. We:
 *   1. Verify state cookie + HMAC + expiry (same defense pattern as
 *      Google).
 *   2. Exchange the code for tokens.
 *   3. Encrypt refresh_token + persist on shops row alongside the
 *      realmId (Intuit's "company ID").
 *   4. Redirect to /fr/settings/payments with ?qb=connected.
 *
 * `realmId` matters: it's the company the user authorized us against.
 * Required on every subsequent API call to Intuit. We store it on the
 * shop so the next payment can route to the right company without
 * asking the user again.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATE_COOKIE = 'kua-qb-oauth-state';

// Security audit #8 â€” state verification moved to lib/security/oauth-state.ts
// which hard-fails in production on missing NOTIFICATION_ENCRYPTION_KEY.

function safeRedirect(origin: string, params: Record<string, string>): NextResponse {
  const url = new URL('/fr/settings/payments', origin);
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
    return safeRedirect(origin, { qb: 'error', reason: errParam });
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const realmId = url.searchParams.get('realmId');
  if (!code || !state || !realmId) {
    return safeRedirect(origin, { qb: 'error', reason: 'missing_params' });
  }

  if (!quickbooksConfigured()) {
    return safeRedirect(origin, { qb: 'error', reason: 'not_configured' });
  }
  if (!encryptionConfigured()) {
    return safeRedirect(origin, { qb: 'error', reason: 'encryption_not_configured' });
  }

  // CSRF + HMAC + expiry.
  const cookie = req.cookies.get(STATE_COOKIE)?.value;
  if (!cookie || cookie !== state) {
    return safeRedirect(origin, { qb: 'error', reason: 'state_mismatch' });
  }
  const [payloadB64, sig] = state.split('.');
  if (!payloadB64 || !sig) {
    return safeRedirect(origin, { qb: 'error', reason: 'malformed_state' });
  }
  const payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
  if (!verifyOauthState(payload, sig)) {
    return safeRedirect(origin, { qb: 'error', reason: 'invalid_signature' });
  }
  let parsed: { shopId: string; nonce: string; exp: number };
  try {
    parsed = JSON.parse(payload);
  } catch {
    return safeRedirect(origin, { qb: 'error', reason: 'invalid_payload' });
  }
  if (parsed.exp < Math.floor(Date.now() / 1000)) {
    return safeRedirect(origin, { qb: 'error', reason: 'state_expired' });
  }
  const shopId = parsed.shopId;

  try {
    const redirectUri = `${origin}/api/quickbooks/oauth/callback`;
    const token = await exchangeQbCode({ code, redirectUri });
    const refreshEnc = encrypt(token.refresh_token);

    // Loop 46 (P98) â€” capture refresh-token expiry on initial
    // connect. Intuit returns `x_refresh_token_expires_in` (seconds)
    // alongside the token; we project that forward to an absolute
    // timestamp so the cron can scan an indexed timestamptz column
    // instead of computing dates per-row.
    const refreshExpiresAt = new Date(
      Date.now() + token.x_refresh_token_expires_in * 1000,
    ).toISOString();

    const admin = createSupabaseServiceRoleClient();
    await admin
      .from('shops')
      .update({
        quickbooks_realm_id: realmId,
        quickbooks_refresh_token_enc: refreshEnc,
        quickbooks_refresh_token_expires_at: refreshExpiresAt,
        quickbooks_last_refreshed_at: new Date().toISOString(),
        quickbooks_connect_status: 'active',
      })
      .eq('id', shopId);

    return safeRedirect(origin, { qb: 'connected' });
  } catch (e) {
    captureException(e, { tags: { layer: 'qb-oauth', stage: 'callback' } });
    return safeRedirect(origin, { qb: 'error', reason: 'unexpected' });
  }
}
