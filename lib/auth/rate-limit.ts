/**
 * Best-effort in-memory rate limit.
 *
 * Designed for V1 deployment: simple fixed-window counter per (key) keyed
 * usually on `${action}:${ip}`. Acceptable when the app runs in a single
 * long-lived Node process (e.g. `next start`).
 *
 * **Limitations**:
 *  - On Vercel serverless functions, each cold start re-initializes the Map,
 *    so determined attackers can reset the window by burning instances. For
 *    a hardened production setup, swap to Upstash/Vercel KV (drop-in
 *    replacement at the call site).
 *  - The map grows unbounded; we purge expired entries lazily on every check.
 *
 * Returns `{ allowed, remaining, resetAt }`.
 */

type Bucket = { count: number; resetAt: number };

const store = new Map<string, Bucket>();

export type RateLimitConfig = {
  /** Maximum allowed hits in the window. */
  max: number;
  /** Window size in milliseconds. */
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

export function checkRateLimit(key: string, cfg: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const bucket = store.get(key);

  if (!bucket || bucket.resetAt <= now) {
    const fresh: Bucket = { count: 1, resetAt: now + cfg.windowMs };
    store.set(key, fresh);
    // Opportunistic cleanup: drop expired entries every ~256 inserts.
    if (store.size > 256) {
      for (const [k, v] of store) {
        if (v.resetAt <= now) store.delete(k);
      }
    }
    return { allowed: true, remaining: cfg.max - 1, resetAt: fresh.resetAt };
  }

  bucket.count += 1;
  if (bucket.count > cfg.max) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }
  return { allowed: true, remaining: cfg.max - bucket.count, resetAt: bucket.resetAt };
}

/** Test helper — never used in app code. Cleared between tests. */
export function _resetRateLimitStore() {
  store.clear();
}
