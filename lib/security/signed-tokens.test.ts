import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signToken, verifyToken } from './signed-tokens';

/**
 * Signed-token tests — the security primitive behind every public,
 * session-less route: /review/[token], /me/[token], /unsubscribe/[token],
 * receipts and reschedule links. The token IS the auth there, so its
 * rejection paths (bad signature, expiry, wrong kind, revocation version)
 * are what keep those routes safe.
 *
 * We set NOTIFICATION_ENCRYPTION_KEY only inside these tests (mirrors
 * aes.test.ts) and restore the prior value afterwards.
 */
const TEST_KEY = Buffer.alloc(32, 11).toString('base64');

describe('signed tokens', () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.NOTIFICATION_ENCRYPTION_KEY;
    process.env.NOTIFICATION_ENCRYPTION_KEY = TEST_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.NOTIFICATION_ENCRYPTION_KEY;
    else process.env.NOTIFICATION_ENCRYPTION_KEY = savedKey;
  });

  it('round-trips a valid token', () => {
    const token = signToken({ kind: 'unsub', resourceId: 'client-1', expiresInSeconds: 3600 });
    const payload = verifyToken(token, 'unsub');
    expect(payload).not.toBeNull();
    expect(payload?.kind).toBe('unsub');
    expect(payload?.resourceId).toBe('client-1');
    expect(payload?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects a wrong-kind verification (kind is part of the signed payload)', () => {
    // A 'review' token must not be replayable as an 'unsub' or 'me' token,
    // even though all three carry a resourceId.
    const token = signToken({ kind: 'review', resourceId: 'appt-1', expiresInSeconds: 3600 });
    expect(verifyToken(token, 'review')).not.toBeNull();
    expect(verifyToken(token, 'unsub')).toBeNull();
    expect(verifyToken(token, 'me')).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = signToken({ kind: 'me', resourceId: 'client-1', expiresInSeconds: -10 });
    expect(verifyToken(token, 'me')).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const token = signToken({ kind: 'me', resourceId: 'client-1', expiresInSeconds: 3600 });
    const payloadB64 = token.split('.')[0];
    // 43 base64url chars → 32 bytes of 0x00: right length, wrong bytes.
    const forged = `${payloadB64}.${'A'.repeat(43)}`;
    expect(verifyToken(forged, 'me')).toBeNull();
  });

  it('rejects a payload spliced onto another token’s signature', () => {
    // Swapping in a different resourceId's payload invalidates the signature,
    // which was computed over the original payload bytes.
    const a = signToken({ kind: 'me', resourceId: 'client-A', expiresInSeconds: 3600 });
    const b = signToken({ kind: 'me', resourceId: 'client-B', expiresInSeconds: 3600 });
    const sigA = a.split('.')[1];
    const payloadB = b.split('.')[0];
    expect(verifyToken(`${payloadB}.${sigA}`, 'me')).toBeNull();
  });

  it('rejects structurally malformed tokens', () => {
    expect(verifyToken('', 'me')).toBeNull();
    expect(verifyToken('noseparator', 'me')).toBeNull();
    expect(verifyToken('a.b.c', 'me')).toBeNull();
    expect(verifyToken('x'.repeat(5000), 'me')).toBeNull();
  });

  it('round-trips the revocation version (W5c)', () => {
    const token = signToken({ kind: 'me', resourceId: 'client-1', expiresInSeconds: 3600, ver: 4 });
    expect(verifyToken(token, 'me')?.ver).toBe(4);
  });

  it('omits ver on legacy tokens (callers treat absent as 0)', () => {
    const token = signToken({ kind: 'me', resourceId: 'client-1', expiresInSeconds: 3600 });
    expect(verifyToken(token, 'me')?.ver).toBeUndefined();
  });

  it('is bound to the secret (a different key fails to verify)', () => {
    const token = signToken({ kind: 'unsub', resourceId: 'client-1', expiresInSeconds: 3600 });
    process.env.NOTIFICATION_ENCRYPTION_KEY = Buffer.alloc(32, 22).toString('base64');
    expect(verifyToken(token, 'unsub')).toBeNull();
  });
});
