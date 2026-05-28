/**
 * Phase F — platform_config reader.
 *
 * Single source of truth for the Küa-wide application fee BPS. Replaces
 * the `STRIPE_APP_FEE_BPS` env var as the canonical source; the env var
 * now only serves as the graceful-degradation fallback if the DB read
 * fails (e.g. service-role auth blip during a payment flow).
 *
 * The fee value is cached in-process for 30s so the hot booking path
 * doesn't hit Postgres on every PI mint. A super-admin save flips the
 * cache by setting `lastInvalidatedAt` — anything older than that is
 * forced to refetch.
 *
 * The fetch uses the service-role client because the booking path is
 * unauthenticated (public booking from a wizard); the RLS policy gates
 * super-admin writes anyway.
 */
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { captureException } from '@/lib/observability';

type Cache = { bps: number; expiresAt: number };

const TTL_MS = 30_000;
let cache: Cache | null = null;
let lastInvalidatedAt = 0;

/**
 * Returns the platform application fee in basis points (100 = 1%).
 *
 * Reads `platform_config.app_fee_bps` for the singleton row (id=1).
 * Falls back to `STRIPE_APP_FEE_BPS` env var on any DB error so a
 * misconfigured database doesn't accidentally turn the fee off.
 */
export async function getPlatformAppFeeBps(): Promise<number> {
  const now = Date.now();
  if (cache && cache.expiresAt > now && lastInvalidatedAt <= now - TTL_MS) {
    return cache.bps;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createSupabaseServiceRoleClient() as any;
    const res = await sb.from('platform_config').select('app_fee_bps').eq('id', 1).single();
    const row = res.data as { app_fee_bps: number } | null;
    const bps = Number(row?.app_fee_bps ?? 0);
    const clamped = Number.isFinite(bps) && bps >= 0 ? Math.min(bps, 10_000) : 0;
    cache = { bps: clamped, expiresAt: now + TTL_MS };
    return clamped;
  } catch (e) {
    captureException(e, { tags: { layer: 'platform-config' } });
    const envBps = Number(process.env.STRIPE_APP_FEE_BPS ?? 0);
    return Number.isFinite(envBps) && envBps > 0 ? Math.min(envBps, 10_000) : 0;
  }
}

/**
 * Compute the application_fee_amount in cents for a given PI amount,
 * using the current platform-config BPS. Used by `createDepositPaymentIntent`
 * and `getReusableDepositPaymentIntent` to decide what fee to apply.
 *
 * Pure helper that takes BPS as a parameter — kept that way so the
 * caller can fetch BPS once and pass it through to multiple call
 * sites in the same request, sharing a single DB read.
 */
export function applicationFeeForAmount(amountCents: number, bps: number): number {
  if (!Number.isFinite(bps) || bps <= 0 || amountCents <= 0) return 0;
  return Math.round((amountCents * bps) / 10_000);
}

/**
 * Forces the cache to refetch on the next read. Called by the super-
 * admin save action so a fee change is visible immediately instead of
 * waiting up to 30s.
 */
export function invalidatePlatformConfigCache(): void {
  lastInvalidatedAt = Date.now();
  cache = null;
}
