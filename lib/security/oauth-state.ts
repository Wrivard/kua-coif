/**
 * Security audit #8 (MINOR) — OAuth state HMAC must not fall back to a
 * public constant.
 *
 * Pre-fix, the Google + QuickBooks OAuth routes each declared their own
 * `signState(payload)` helper with `process.env.NOTIFICATION_ENCRYPTION_KEY
 * ?? 'dev-only-fallback'`. If the env var was ever unset in production
 * (typo in Vercel, vault sync failure, etc.), the HMAC key reverted to
 * a hardcoded constant — making the OAuth state predictable and
 * defeating its CSRF protection on those flows.
 *
 * This helper centralizes the read + hard-fails (throws) when the key
 * is missing AND `NODE_ENV === 'production'`. Dev keeps the fallback so
 * a developer can run the flow without provisioning the var first.
 *
 * Hard-fail is correct here because the OAuth flow is a security
 * boundary — silently degrading to a public constant is worse than
 * surfacing a 500 that an operator can fix in env config.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

function getStateSecret(): string {
  const raw = process.env.NOTIFICATION_ENCRYPTION_KEY;
  if (raw) return raw;
  if (process.env.NODE_ENV === 'production') {
    // Throwing surfaces a 500 — the OAuth flow can't proceed without
    // a real signing key. Caller is expected to handle the throw and
    // return a clean error response to the user.
    throw new Error('NOTIFICATION_ENCRYPTION_KEY required for OAuth state signing');
  }
  // Dev only — explicit so it doesn't masquerade as production-safe.
  return 'dev-only-fallback';
}

/**
 * HMAC-SHA256 sign a state payload. Returns base64url-encoded digest.
 * Throws in production when the signing key is missing.
 */
export function signOauthState(payload: string): string {
  return createHmac('sha256', getStateSecret()).update(payload).digest('base64url');
}

/**
 * Constant-time verify an OAuth state cookie/query parameter.
 * Returns true iff the signature matches. Never throws — a bad
 * signature or missing key is treated as verification failure.
 */
export function verifyOauthState(payload: string, signature: string): boolean {
  let expected: string;
  try {
    expected = signOauthState(payload);
  } catch {
    return false;
  }
  if (expected.length !== signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'));
  } catch {
    return false;
  }
}
