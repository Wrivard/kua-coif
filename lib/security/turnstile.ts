/**
 * Cloudflare Turnstile — Phase 30.
 *
 * Privacy-friendly CAPTCHA alternative used to gate the public booking form
 * against bots. Cloudflare's challenge solver runs in the browser; we verify
 * the resulting token server-side here.
 *
 * Activation flow:
 *   1. Create a free Cloudflare account, then add a Turnstile site at
 *      https://dash.cloudflare.com/?to=/:account/turnstile.
 *   2. Set the "Domain" to your Vercel domain (and `localhost` for dev).
 *   3. Copy the **Site Key** → `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (public,
 *      shipped to browser).
 *   4. Copy the **Secret Key** → `TURNSTILE_SECRET_KEY` (server-only).
 *   5. Redeploy. The booking form starts rendering the challenge and the
 *      server starts verifying.
 *
 * Until both env vars are set, this module is a no-op: `turnstileConfigured()`
 * returns false and `verifyTurnstile()` returns `{ ok: true }` so the booking
 * keeps working with just the honeypot + rate-limit defenses. The widget on
 * the client side also skips rendering when the site key is absent — see
 * `components/ui/turnstile.tsx`.
 *
 * Cloudflare's verify endpoint:
 *   POST https://challenges.cloudflare.com/turnstile/v0/siteverify
 *   Body: secret, response (the client-supplied token), remoteip (optional)
 *   Response: { success: bool, "error-codes": [...], hostname, action, ... }
 *
 * Docs: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function turnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

export type TurnstileResult = { ok: true } | { ok: false; reason: string };

/**
 * Verify a Turnstile token against Cloudflare's API.
 *
 * - If env var is missing → returns `{ ok: true }` (feature off, allow through).
 * - If token is empty when verification IS required → `{ ok: false }`.
 * - If Cloudflare returns success: false → `{ ok: false, reason: <codes> }`.
 * - If the fetch itself fails (network, Cloudflare down) → `{ ok: false }`
 *   so we fail closed. Honeypot + rate limit still catch the booking if a
 *   bot retries.
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp: string,
): Promise<TurnstileResult> {
  if (!turnstileConfigured()) return { ok: true };

  if (!token || token.length < 10) {
    return { ok: false, reason: 'missing_token' };
  }

  const secret = process.env.TURNSTILE_SECRET_KEY!;
  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  if (remoteIp && remoteIp !== 'unknown') body.set('remoteip', remoteIp);

  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      body,
      // Don't hammer Cloudflare if a single user retries quickly — the token
      // is single-use anyway, so we don't need caching here. `no-store`
      // skips Next.js's fetch cache layer.
      cache: 'no-store',
    });
    if (!res.ok) {
      return { ok: false, reason: `http_${res.status}` };
    }
    const data = (await res.json()) as {
      success: boolean;
      'error-codes'?: string[];
    };
    if (!data.success) {
      return {
        ok: false,
        reason: data['error-codes']?.join(',') || 'cloudflare_rejected',
      };
    }
    return { ok: true };
  } catch {
    // Fail closed — don't let a Cloudflare outage turn into an unprotected
    // booking endpoint. Honeypot + rate limit are still in effect.
    return { ok: false, reason: 'verification_failed' };
  }
}
