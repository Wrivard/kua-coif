/**
 * Signed tokens — Phase 63b/68.
 *
 * HMAC-SHA256 signed tokens for one-shot public access to a specific
 * resource without requiring a logged-in user. Used for:
 *
 *  - "Leave a review" links in the post-appointment email (the review
 *    submission page accepts no auth, only a valid token that names a
 *    specific appointment + client).
 *  - "Manage your booking / loyalty" links on the /me public page
 *    (same mechanism, different resource type).
 *
 * Token format: `${payloadB64}.${signatureB64}` where:
 *   - payloadB64 = base64url-encoded JSON `{ kind, resourceId, exp }`
 *     - `kind`: discriminator ('review' | 'me')
 *     - `resourceId`: the appointment_id (review) or client_id (me)
 *     - `exp`: UNIX timestamp (seconds) after which the token is invalid
 *   - signatureB64 = base64url-encoded HMAC-SHA256(payloadB64, secret)
 *
 * Secret = `NOTIFICATION_ENCRYPTION_KEY` env var (already in production,
 * used by the Phase 25 encryption helpers). Same secret across token
 * kinds — `kind` is part of the signed payload so a "review" token
 * can't be replayed as a "me" token even if the same resourceId
 * coincidentally collided.
 *
 * Why HMAC + base64url and not JWT: zero deps, no clock-skew library
 * to vet, format is human-debuggable. We're not interoperating with
 * external systems — this is purely an internal signing primitive.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

type TokenPayload = {
  kind: 'review' | 'me' | 'receipt' | 'reschedule' | 'unsub';
  /**
   * Resource ID — appointment for `review`/`receipt`/`reschedule`,
   * client for `me`/`unsub`.
   */
  resourceId: string;
  /** UNIX seconds, after which the token is invalid. */
  exp: number;
  /**
   * Optional revocation version (currently `me` only). Embedded at mint and
   * compared against the resource's current version at verify time; bumping
   * the resource's version invalidates every outstanding token. Absent on
   * legacy tokens → treated as 0 by the caller.
   */
  ver?: number;
};

function secret(): string {
  const key = process.env.NOTIFICATION_ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      'NOTIFICATION_ENCRYPTION_KEY env var missing — required for signed-token operations.',
    );
  }
  return key;
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  // Restore padding so Node's base64 parser accepts it.
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Sign a payload into a token. The caller passes `expiresInSeconds`
 * (e.g. 60 * 60 * 24 * 30 for 30 days); we materialize `exp` here so
 * call sites don't have to think about UNIX time math.
 */
export function signToken(input: {
  kind: TokenPayload['kind'];
  resourceId: string;
  expiresInSeconds: number;
  /** Revocation version to embed (omit for kinds without revocation). */
  ver?: number;
}): string {
  const payload: TokenPayload = {
    kind: input.kind,
    resourceId: input.resourceId,
    exp: Math.floor(Date.now() / 1000) + input.expiresInSeconds,
    // undefined is dropped by JSON.stringify, so legacy kinds stay unchanged.
    ver: input.ver,
  };
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = createHmac('sha256', secret()).update(payloadB64).digest();
  return `${payloadB64}.${b64urlEncode(sig)}`;
}

/**
 * Verify and decode a token. Returns the payload on success, null on
 * any failure (bad format, bad signature, expired, wrong kind). Caller
 * checks the `kind` matches its expectation BEFORE acting — passing
 * `expectedKind` short-circuits this check.
 */
export function verifyToken(
  token: string,
  expectedKind: TokenPayload['kind'],
): TokenPayload | null {
  if (typeof token !== 'string' || token.length < 10 || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts as [string, string];

  // Signature check first (cheap, constant-time, doesn't leak payload).
  let valid = false;
  try {
    const expected = createHmac('sha256', secret()).update(payloadB64).digest();
    const provided = b64urlDecode(sigB64);
    if (expected.length !== provided.length) return null;
    valid = timingSafeEqual(expected, provided);
  } catch {
    return null;
  }
  if (!valid) return null;

  // Decode + structural validate the payload.
  let payload: TokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8')) as TokenPayload;
  } catch {
    return null;
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof payload.resourceId !== 'string' ||
    typeof payload.exp !== 'number' ||
    payload.kind !== expectedKind
  ) {
    return null;
  }

  // Expiry check.
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;

  return payload;
}
