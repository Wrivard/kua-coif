import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { revalidateTag } from 'next/cache';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { captureException } from '@/lib/observability';

/**
 * Loop 50 (Phase 97 from AUDIT_PHASE70) — Google Calendar webhook
 * handler.
 *
 * Google POSTs an empty body and a set of `X-Goog-*` headers
 * whenever a watched calendar changes. Our job:
 *   1. Validate X-Goog-Channel-Token matches the secret we stored
 *      at subscription time (drops spoofed POSTs).
 *   2. Bust the `google-busy` cache tag so the next FreeBusy read
 *      hits Google fresh.
 *   3. Reply 200 fast — Google retries 4xx/5xx with backoff and
 *      may de-subscribe a flapping channel.
 *
 * The `sync` resource-state is Google's initial-handshake POST and
 * carries no actual change; we still 200 it but skip the cache
 * bust. Every other state (`exists`, `not_exists`) means a real
 * mutation.
 *
 * Security:
 *   - The channel token IS the auth gate. No need for a generic
 *     CRON_SECRET-style bearer.
 *   - We never trust the request body (Google sends empty). All
 *     routing comes from the validated channel ID.
 *
 * Out of scope for this loop (future work):
 *   - Signature verification via X-Goog-Resource-Uri parse + JWT
 *     (Google doesn't sign these notifications; the token IS the
 *     proof). Channel-token rotation on a schedule.
 *   - Per-barber cache invalidation (current `revalidateTag('google-busy')`
 *     busts every shop's overlay). Acceptable for V1 — the next
 *     read re-fetches only the visible day per barber, ~250ms.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 10;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const channelId = req.headers.get('x-goog-channel-id');
  const channelToken = req.headers.get('x-goog-channel-token');
  const resourceState = req.headers.get('x-goog-resource-state');

  // Missing headers = not a Google webhook (or a Google bug). Reply
  // 200 so Google doesn't retry; the missing headers are
  // unrecoverable.
  if (!channelId || !channelToken) {
    return new NextResponse(null, { status: 200 });
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseServiceRoleClient() as any;
    const res = await admin
      .from('barber_google_calendar')
      .select('barber_id, webhook_token')
      .eq('webhook_channel_id', channelId)
      .maybeSingle();
    const row = res.data as { barber_id: string; webhook_token: string | null } | null;

    // Unknown channel ID OR token mismatch → drop silently with 200.
    // 4xx would trigger Google's retry/backoff; we don't want that
    // for spoofed POSTs, just black-hole them.
    //
    // Security audit #9 — constant-time compare. The webhook_channel_id
    // we mint is part of the URL Google calls back; if leaked, an
    // attacker could brute-force the token via timing differences in
    // a naive `!==` compare. timingSafeEqual + length pre-check is the
    // standard pattern (matches the Twilio webhook).
    if (!row || !row.webhook_token) {
      return new NextResponse(null, { status: 200 });
    }
    const tokenMatch =
      row.webhook_token.length === channelToken.length &&
      timingSafeEqual(Buffer.from(row.webhook_token), Buffer.from(channelToken));
    if (!tokenMatch) {
      return new NextResponse(null, { status: 200 });
    }

    // `sync` is Google's initial handshake when we subscribed. No
    // actual change happened; ack and move on.
    if (resourceState === 'sync') {
      return new NextResponse(null, { status: 200 });
    }

    // Real change — bust the FreeBusy cache. The tag is shared
    // across all barbers; the next read re-fetches the visible day
    // for the barber the calendar actually shows. A future loop
    // could shard the cache key per-barber for finer invalidation.
    revalidateTag('google-busy');

    // Bump `last_synced_at` so the settings UI's "Last synced"
    // label stays fresh even without an explicit push.
    await admin
      .from('barber_google_calendar')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('barber_id', row.barber_id);

    return new NextResponse(null, { status: 200 });
  } catch (e) {
    captureException(e, {
      tags: { layer: 'google-webhook', channelId: channelId.slice(0, 8) },
    });
    // 200 anyway — Google's retry only helps for transient errors,
    // and our DB issues won't resolve on a retry. Sentry captured;
    // the next manual push will eventually re-sync.
    return new NextResponse(null, { status: 200 });
  }
}
