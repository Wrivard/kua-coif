import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { decrypt, encrypt, encryptionConfigured } from '@/lib/crypto/aes';
import { refreshQbToken, quickbooksConfigured } from '@/lib/quickbooks/server';
import { captureException } from '@/lib/observability';
import { isCronAuthorized } from '@/lib/security/cron-auth';

/**
 * Loop 46 (Phase 98 from AUDIT_PHASE70) — proactive QuickBooks
 * refresh-token rotation.
 *
 * Intuit's refresh tokens expire after 100 days of inactivity. Once
 * expired, the shop must re-OAuth from scratch — a manager+ action
 * the owner is unlikely to do voluntarily until the next time they
 * notice their invoices aren't syncing. We avoid that fail-open by
 * scheduling this cron to fire daily; each run refreshes any token
 * within 14 days of expiry.
 *
 * Why 14 days: absorbs a Vercel cron miss (their scheduler isn't
 * SLA-strict) without dropping the connection. A token refreshed
 * once will be skipped on subsequent runs because its expiry slides
 * forward by another ~100 days.
 *
 * Idempotent: a token already refreshed today simply doesn't match
 * the "expiring soon" filter again. Even if two cron ticks overlap,
 * Intuit's refresh endpoint is idempotent (returns the same new
 * refresh token for repeated calls within the same key).
 *
 * Security: the same `CRON_SECRET` bearer pattern as
 * `/api/cron/notifications`. Vercel cron auto-attaches the header
 * when CRON_SECRET is set; without the env var the route runs
 * unprotected (dev only).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

// Cron auth lives in one place (lib/security/cron-auth): fail-CLOSED in
// production when CRON_SECRET is unset, constant-time bearer compare.
function isAuthorized(req: NextRequest): boolean {
  return isCronAuthorized(req);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  if (!quickbooksConfigured() || !encryptionConfigured()) {
    // No QuickBooks app credentials OR no encryption key — nothing
    // we can do. Return 200 with a no-op summary so the cron run
    // shows green in Vercel logs.
    return NextResponse.json({ ok: true, processed: 0, reason: 'not-configured' });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createSupabaseServiceRoleClient() as any;

  // Find shops whose refresh token is within 14 days of expiry. We
  // also filter out null tokens defensively (a legacy shop connected
  // before Loop 46 won't have a stored expiry — they'll get one on
  // first refresh after THIS migration lands + an OAuth round-trip).
  const cutoff = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const candidatesRes = await admin
    .from('shops')
    .select('id, quickbooks_refresh_token_enc, quickbooks_refresh_token_expires_at')
    .eq('quickbooks_connect_status', 'active')
    .not('quickbooks_refresh_token_enc', 'is', null)
    .lte('quickbooks_refresh_token_expires_at', cutoff);

  const candidates =
    (candidatesRes.data as Array<{
      id: string;
      quickbooks_refresh_token_enc: string;
      quickbooks_refresh_token_expires_at: string | null;
    }> | null) ?? [];

  let refreshed = 0;
  let failed = 0;

  // Serial loop (not Promise.all) so the route stays well under the
  // 30s maxDuration even when N is large. Each refresh is ~300ms;
  // a busy run with 50 shops finishes in ~15s.
  for (const shop of candidates) {
    try {
      const currentRefreshToken = decrypt(shop.quickbooks_refresh_token_enc);
      const tokenResponse = await refreshQbToken(currentRefreshToken);

      // Intuit usually returns a NEW refresh token on rotation. Save it
      // immediately — using the old one again after rotation invalidates
      // the new one server-side.
      const newRefreshEnc = encrypt(tokenResponse.refresh_token);
      const newExpiresAt = new Date(
        Date.now() + tokenResponse.x_refresh_token_expires_in * 1000,
      ).toISOString();
      const now = new Date().toISOString();

      await admin
        .from('shops')
        .update({
          quickbooks_refresh_token_enc: newRefreshEnc,
          quickbooks_refresh_token_expires_at: newExpiresAt,
          quickbooks_last_refreshed_at: now,
        })
        .eq('id', shop.id);

      refreshed += 1;
    } catch (e) {
      // A failure here is usually one of:
      //   - Intuit returned 400 invalid_grant → refresh token is dead
      //     (e.g., user revoked from QB side). Flip status to
      //     'disconnected' so the settings UI prompts a re-OAuth.
      //   - Network blip → leave as-is, next cron run retries.
      // We distinguish via the error message; conservative default is
      // to leave the row alone and Sentry the error.
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes('invalid_grant') || message.includes('400')) {
        try {
          await admin
            .from('shops')
            .update({ quickbooks_connect_status: 'disconnected' })
            .eq('id', shop.id);
        } catch {
          // Suppress nested write failures — Sentry below catches the
          // upstream root cause.
        }
      }
      captureException(e, {
        tags: { layer: 'qb-cron', stage: 'refresh' },
        extra: { shopId: shop.id },
      });
      failed += 1;
    }
  }

  return NextResponse.json({ ok: true, processed: candidates.length, refreshed, failed });
}
