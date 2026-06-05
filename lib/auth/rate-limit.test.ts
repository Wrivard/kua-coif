import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRateLimit, _resetRateLimitStore } from './rate-limit';

// These tests exercise the in-memory fallback path that is active whenever the
// Upstash env vars are absent (local / CI / the build). They guarantee the
// public `checkRateLimit` API keeps the V1 fixed-window behavior so callers
// (signin/signup actions, booking slots route, widget event API) are unaffected
// when Upstash isn't configured.

beforeEach(() => {
  // No Upstash env in the test runner, so getRedis() returns null and every
  // call routes to the in-memory store. Make that explicit + reset state.
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
  _resetRateLimitStore();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  _resetRateLimitStore();
});

describe('checkRateLimit (in-memory fallback)', () => {
  it('allows hits up to max then blocks, decrementing remaining', async () => {
    const cfg = { max: 3, windowMs: 60_000 };

    const r1 = await checkRateLimit('ip:a', cfg);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = await checkRateLimit('ip:a', cfg);
    expect(r2).toMatchObject({ allowed: true, remaining: 1 });

    const r3 = await checkRateLimit('ip:a', cfg);
    expect(r3).toMatchObject({ allowed: true, remaining: 0 });

    const r4 = await checkRateLimit('ip:a', cfg);
    expect(r4).toMatchObject({ allowed: false, remaining: 0 });
  });

  it('keeps separate buckets per key', async () => {
    const cfg = { max: 1, windowMs: 60_000 };

    expect((await checkRateLimit('ip:x', cfg)).allowed).toBe(true);
    expect((await checkRateLimit('ip:x', cfg)).allowed).toBe(false);
    // A different key is unaffected.
    expect((await checkRateLimit('ip:y', cfg)).allowed).toBe(true);
  });

  it('resets the bucket once the window elapses', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const cfg = { max: 1, windowMs: 1_000 };

    expect((await checkRateLimit('ip:t', cfg)).allowed).toBe(true);
    expect((await checkRateLimit('ip:t', cfg)).allowed).toBe(false);

    // Advance past the window — the bucket should be fresh again.
    vi.setSystemTime(1_500);
    const after = await checkRateLimit('ip:t', cfg);
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(0);
  });
});
