/**
 * Rate limiting — Upstash Redis when configured, in-memory otherwise.
 *
 * Phase 21 upgrade from the V1 in-memory-only design. The in-memory variant
 * survives as a **dev / local fallback** so the app boots without any
 * external dependency — when `UPSTASH_REDIS_REST_URL` and `*_TOKEN` aren't
 * set, callers transparently get the same behavior the V1 module had.
 *
 * **Why bother switching for prod**: in-memory state on Vercel serverless is
 * scoped to a single Edge/Node instance. Every cold start resets the
 * counters, and concurrent function invocations don't see each other's
 * buckets — so a determined attacker can flood the endpoints by burning
 * instances. Upstash gives us a single shared sliding-window across every
 * region / function / cold start.
 *
 * Activation flow for the user (zero code change after this):
 *   1. Sign up for Upstash (free tier 10k commands/day).
 *   2. Create a Redis DB in a region close to Vercel.
 *   3. Copy `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` into
 *      Vercel env vars (Preview + Production).
 *   4. Redeploy — next request flips to the shared-state limiter.
 */
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export type RateLimitConfig = {
  /** Maximum allowed hits in the window. */
  max: number;
  /** Window size in milliseconds. */
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Unix ms when the current bucket resets. */
  resetAt: number;
};

// ---------------------------------------------------------------------------
// Upstash path
// ---------------------------------------------------------------------------

let cachedRedis: Redis | null = null;
const ratelimitCache = new Map<string, Ratelimit>();

function getRedis(): Redis | null {
  if (cachedRedis) return cachedRedis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  cachedRedis = new Redis({ url, token });
  return cachedRedis;
}

function getLimiterFor(cfg: RateLimitConfig): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;
  const cacheKey = `${cfg.max}:${cfg.windowMs}`;
  let limiter = ratelimitCache.get(cacheKey);
  if (!limiter) {
    // `slidingWindow` expects a typed duration string. Build it from ms.
    // The minimum granularity that matches the Upstash spec is seconds.
    const seconds = Math.max(1, Math.round(cfg.windowMs / 1000));
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(cfg.max, `${seconds} s` as `${number} s`),
      // Disable analytics to stay under the free-tier command quota — we
      // already log via the audit log / Sentry where it matters.
      analytics: false,
      // Namespacing the key so we don't collide with anything else the
      // shop might put in the same Redis instance.
      prefix: 'kua-rl',
    });
    ratelimitCache.set(cacheKey, limiter);
  }
  return limiter;
}

// ---------------------------------------------------------------------------
// In-memory fallback (V1 behavior, kept for dev / no-Upstash deployments)
// ---------------------------------------------------------------------------

type Bucket = { count: number; resetAt: number };
const memoryStore = new Map<string, Bucket>();

function checkInMemory(key: string, cfg: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const bucket = memoryStore.get(key);

  if (!bucket || bucket.resetAt <= now) {
    const fresh: Bucket = { count: 1, resetAt: now + cfg.windowMs };
    memoryStore.set(key, fresh);
    // Opportunistic cleanup: drop expired entries every ~256 inserts so the
    // Map doesn't grow unbounded under sustained traffic.
    if (memoryStore.size > 256) {
      for (const [k, v] of memoryStore) {
        if (v.resetAt <= now) memoryStore.delete(k);
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check (and increment) the bucket for the given key. Async because the
 * Upstash path is networked. Callers in Server Actions already run in an
 * async context, so the `await` is free.
 *
 * If Upstash isn't configured (no env vars), this is a synchronous
 * in-memory check wrapped in a resolved Promise — no network, identical
 * to the V1 behavior.
 */
export async function checkRateLimit(key: string, cfg: RateLimitConfig): Promise<RateLimitResult> {
  const limiter = getLimiterFor(cfg);
  if (limiter) {
    const res = await limiter.limit(key);
    return {
      allowed: res.success,
      remaining: res.remaining,
      resetAt: res.reset,
    };
  }
  return checkInMemory(key, cfg);
}

/** Test helper — never used in app code. Clears the in-memory store only. */
export function _resetRateLimitStore() {
  memoryStore.clear();
  ratelimitCache.clear();
  cachedRedis = null;
}
