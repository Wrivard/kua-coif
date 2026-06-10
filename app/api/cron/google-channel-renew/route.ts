import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { encryptionConfigured } from '@/lib/crypto/aes';
import { renewBarberCalendarSubscription } from '@/lib/google/sync';
import { captureException, withCronMonitor } from '@/lib/observability';
import { isCronAuthorized } from '@/lib/security/cron-auth';

/**
 * Loop 51 (follow-up to P97 / Loop 50) — Google Calendar channel
 * renewal cron.
 *
 * Google's events.watch channels cap at ~30 days. Once a channel
 * expires we stop receiving notifications and the FreeBusy overlay
 * falls back to 60s polling — silent UX degradation. This cron
 * scans daily for channels approaching expiry and rotates them.
 *
 * Scheduling (vercel.json):
 *   - Runs daily at 02:30 UTC (≈ 9:30pm Montreal in winter, well
 *     outside business hours)
 *   - Same `Bearer CRON_SECRET` security as the QB refresh cron
 *
 * Renewal window: channels with `webhook_expires_at < now() + 2
 * days` get rotated. Two-day buffer absorbs at least one Vercel
 * cron miss (their scheduler isn't strict-SLA).
 *
 * Idempotency: the rotation orchestrator
 * (`renewBarberCalendarSubscription`) subscribes a NEW channel
 * first, persists its columns, then stops the OLD. Re-running the
 * cron mid-rotation results in another rotation — the second run's
 * "OLD" is the previous run's "NEW", so we're still in a clean
 * state. Worst case: a few orphan channels on Google's side that
 * auto-expire.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Cron auth lives in one place (lib/security/cron-auth): fail-CLOSED in
// production when CRON_SECRET is unset, constant-time bearer compare.
function isAuthorized(req: NextRequest): boolean {
  return isCronAuthorized(req);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  // Check-in inside the auth gate. Slug + crontab mirror vercel.json.
  return withCronMonitor(
    'cron-google-channel-renew',
    { type: 'crontab', value: '30 2 * * *' },
    () => runGoogleChannelRenewCron(),
  );
}

async function runGoogleChannelRenewCron(): Promise<NextResponse> {
  if (!encryptionConfigured()) {
    return NextResponse.json({ ok: true, processed: 0, reason: 'no-encryption-key' });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createSupabaseServiceRoleClient() as any;
  const cutoff = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const candidatesRes = await admin
    .from('barber_google_calendar')
    .select('barber_id, webhook_expires_at')
    .eq('sync_status', 'active')
    .not('webhook_channel_id', 'is', null)
    .lte('webhook_expires_at', cutoff);

  const candidates =
    (candidatesRes.data as Array<{ barber_id: string; webhook_expires_at: string }> | null) ?? [];

  let renewed = 0;
  let failed = 0;

  // Serial loop — each rotation is two Google API calls (~500ms
  // total) plus a DB write. 60s maxDuration accommodates ~80 shops
  // worth of barbers, well past the practical scale of this
  // platform for V1.
  for (const row of candidates) {
    try {
      await renewBarberCalendarSubscription(row.barber_id);
      renewed += 1;
    } catch (e) {
      captureException(e, {
        tags: { layer: 'google-cron', stage: 'renew' },
        extra: { barberId: row.barber_id },
      });
      failed += 1;
    }
  }

  return NextResponse.json({ ok: true, processed: candidates.length, renewed, failed });
}
