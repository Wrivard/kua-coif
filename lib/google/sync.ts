/**
 * Google Calendar push-sync orchestration — Phase 34.
 *
 * The booking + reschedule + cancel Server Actions call into this module
 * with the new appointment state. We resolve which barber owns the
 * appointment, check if they have a Google connection, and (if so) push
 * the change to their personal Google Calendar.
 *
 * Best-effort by design: a Google API failure must NEVER cause the
 * underlying appointment mutation to fail — the Küa calendar is the
 * source of truth and the user-facing flow stays intact even if Google
 * is down or the token is revoked. Errors are captured to Sentry +
 * persisted on `barber_google_calendar.last_error` so the settings UI
 * can surface a "reconnect" CTA.
 *
 * Idempotency:
 *   * On create:  insert a Google event, persist its ID on the
 *                 appointment row.
 *   * On update:  PUT against the existing event ID if any; else create
 *                 anew (covers the case where the appointment was made
 *                 BEFORE the barber connected Google).
 *   * On cancel:  DELETE if we have an event ID; no-op otherwise.
 *
 * Token strategy: we decrypt the refresh_token, exchange it for a fresh
 * access_token (~50ms), then use that for the API call. We DON'T cache
 * the access_token because:
 *   - It expires in 1h, so a cached one would often be expired anyway.
 *   - Caching adds DB write paths that complicate the failure model.
 *   - 50ms is invisible against the Server Action's existing ~200ms.
 */

import { unstable_cache } from 'next/cache';
import { appUrl } from '@/lib/env/app-url';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { decrypt, encryptionConfigured } from '@/lib/crypto/aes';
import { captureException } from '@/lib/observability';
import { refreshAccessToken } from './server';
import { createEvent, deleteEvent, fetchBusyPeriods, updateEvent } from './calendar';
import { stopCalendarWatch, subscribeCalendarWatch } from './webhook';

type ConnectionRow = {
  refresh_token_enc: string;
  calendar_id: string;
  sync_status: 'active' | 'paused' | 'error';
};

/**
 * Look up + decrypt the barber's connection. Service-role read because
 * the column has REVOKE SELECT for anon/authenticated. Returns null when
 * no connection exists, encryption isn't configured, or sync is paused.
 */
async function resolveConnection(barberId: string): Promise<ConnectionRow | null> {
  if (!encryptionConfigured()) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createSupabaseServiceRoleClient() as any;
  const res = await admin
    .from('barber_google_calendar')
    .select('refresh_token_enc, calendar_id, sync_status')
    .eq('barber_id', barberId)
    .maybeSingle();
  const row = res.data as ConnectionRow | null;
  if (!row || row.sync_status === 'paused') return null;
  return row;
}

/**
 * Mark a connection as errored. Don't throw — this is itself a best-effort
 * write. If it fails we still want the appointment mutation to succeed.
 */
async function markError(barberId: string, error: unknown): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseServiceRoleClient() as any;
    await admin
      .from('barber_google_calendar')
      .update({
        sync_status: 'error',
        last_error: error instanceof Error ? error.message : String(error),
      })
      .eq('barber_id', barberId);
  } catch {
    // Swallow — see comment above.
  }
}

async function markSynced(barberId: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseServiceRoleClient() as any;
    await admin
      .from('barber_google_calendar')
      .update({
        sync_status: 'active',
        last_synced_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('barber_id', barberId);
  } catch {
    // Swallow.
  }
}

/**
 * Persist the Google event ID on the appointment row. Required so future
 * updates / cancels can find the right remote event.
 */
async function persistEventId(appointmentId: string, eventId: string | null): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseServiceRoleClient() as any;
    await admin.from('appointments').update({ google_event_id: eventId }).eq('id', appointmentId);
  } catch (e) {
    captureException(e, { tags: { layer: 'google-sync', stage: 'persist-event-id' } });
  }
}

export type AppointmentForSync = {
  appointmentId: string;
  barberId: string;
  startAtIso: string;
  endAtIso: string;
  timezone: string;
  /** Existing event ID if the appointment was already mirrored. */
  googleEventId: string | null;
  summary: string;
  description?: string;
};

/**
 * Push a new or updated appointment to Google. Decides between create vs
 * update based on whether we already have a googleEventId.
 *
 * Always returns gracefully — errors are logged + marked but the caller
 * doesn't need to handle them.
 */
export async function pushAppointment(appt: AppointmentForSync): Promise<void> {
  const conn = await resolveConnection(appt.barberId);
  if (!conn) return;

  try {
    const refreshToken = decrypt(conn.refresh_token_enc);
    const token = await refreshAccessToken(refreshToken);

    if (appt.googleEventId) {
      try {
        await updateEvent({
          accessToken: token.access_token,
          calendarId: conn.calendar_id,
          eventId: appt.googleEventId,
          event: {
            summary: appt.summary,
            description: appt.description,
            startIso: appt.startAtIso,
            endIso: appt.endAtIso,
            timeZone: appt.timezone,
          },
        });
        await markSynced(appt.barberId);
        return;
      } catch (e) {
        // The remote event might have been deleted manually — fall through
        // to create a new one rather than leaving the appointment unsynced.
        captureException(e, {
          tags: { layer: 'google-sync', stage: 'update-fallthrough' },
          extra: { appointmentId: appt.appointmentId },
        });
      }
    }

    const created = await createEvent({
      accessToken: token.access_token,
      calendarId: conn.calendar_id,
      event: {
        summary: appt.summary,
        description: appt.description,
        startIso: appt.startAtIso,
        endIso: appt.endAtIso,
        timeZone: appt.timezone,
      },
    });
    await persistEventId(appt.appointmentId, created.id);
    await markSynced(appt.barberId);
  } catch (e) {
    await markError(appt.barberId, e);
    captureException(e, {
      tags: { layer: 'google-sync', stage: 'push' },
      extra: { appointmentId: appt.appointmentId },
    });
  }
}

/**
 * Pull the barber's personal busy periods for a day window. Returns an
 * empty array on any failure (no connection, expired refresh token,
 * Google outage) so the calendar render path stays robust.
 *
 * Cached via `unstable_cache` keyed by (barber, window) with a 60s TTL.
 * The pure call costs ~250ms (refresh + freeBusy); cache hit is ~5ms.
 * 60s is short enough that Google events booked from outside Küa show
 * up within a minute on the calendar.
 */
export type BusyBlock = { start: string; end: string };

const cachedBusyFetch = unstable_cache(
  async (barberId: string, timeMin: string, timeMax: string): Promise<BusyBlock[]> => {
    const conn = await resolveConnection(barberId);
    if (!conn) return [];
    try {
      const refreshToken = decrypt(conn.refresh_token_enc);
      const token = await refreshAccessToken(refreshToken);
      const busy = await fetchBusyPeriods({
        accessToken: token.access_token,
        calendarId: conn.calendar_id,
        timeMin,
        timeMax,
      });
      // Mark synced AFTER a successful fetch so the settings UI knows
      // the connection is healthy even if no events landed today.
      await markSynced(barberId);
      return busy;
    } catch (e) {
      await markError(barberId, e);
      captureException(e, {
        tags: { layer: 'google-sync', stage: 'busy-fetch' },
        extra: { barberId },
      });
      return [];
    }
  },
  ['google-busy'],
  { revalidate: 60, tags: ['google-busy'] },
);

export async function fetchBarberBusyForDay(
  barberId: string,
  dayStart: Date,
  dayEnd: Date,
): Promise<BusyBlock[]> {
  return cachedBusyFetch(barberId, dayStart.toISOString(), dayEnd.toISOString());
}

/**
 * Delete the mirrored event when an appointment is cancelled.
 */
export async function deleteAppointmentMirror({
  appointmentId,
  barberId,
  googleEventId,
}: {
  appointmentId: string;
  barberId: string;
  googleEventId: string | null;
}): Promise<void> {
  if (!googleEventId) return;
  const conn = await resolveConnection(barberId);
  if (!conn) return;

  try {
    const refreshToken = decrypt(conn.refresh_token_enc);
    const token = await refreshAccessToken(refreshToken);
    await deleteEvent({
      accessToken: token.access_token,
      calendarId: conn.calendar_id,
      eventId: googleEventId,
    });
    await persistEventId(appointmentId, null);
    await markSynced(barberId);
  } catch (e) {
    await markError(barberId, e);
    captureException(e, {
      tags: { layer: 'google-sync', stage: 'delete' },
      extra: { appointmentId },
    });
  }
}

// ---------------------------------------------------------------------------
// Loop 50 (Phase 97) — webhook subscription orchestrators
// ---------------------------------------------------------------------------
//
// `subscribeBarberCalendar` is called either by the OAuth callback
// (right after a fresh connection) or by a future renewal cron.
// `unsubscribeBarberCalendar` is called from the disconnect action
// to politely close the channel on Google's side.
//
// Both are best-effort: a failure leaves the row's webhook columns
// in their previous state and logs to Sentry. The push/pull paths
// continue to work via the 60s FreeBusy polling.

function webhookUrl(): string | null {
  const base = appUrl();
  // Google rejects HTTP and IP-literal hosts — short-circuit when
  // the base URL is missing or local.
  if (!base || !base.startsWith('https://')) return null;
  return `${base}/api/google/calendar-webhook`;
}

export async function subscribeBarberCalendar(barberId: string): Promise<void> {
  const url = webhookUrl();
  if (!url) return; // dev / missing config — skip silently
  const conn = await resolveConnection(barberId);
  if (!conn) return;
  try {
    const refreshToken = decrypt(conn.refresh_token_enc);
    const token = await refreshAccessToken(refreshToken);
    const sub = await subscribeCalendarWatch({
      accessToken: token.access_token,
      calendarId: conn.calendar_id,
      webhookUrl: url,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseServiceRoleClient() as any;
    await admin
      .from('barber_google_calendar')
      .update({
        webhook_channel_id: sub.channelId,
        webhook_resource_id: sub.resourceId,
        webhook_token: sub.channelToken,
        webhook_expires_at: sub.expirationAt,
      })
      .eq('barber_id', barberId);
  } catch (e) {
    captureException(e, {
      tags: { layer: 'google-sync', stage: 'subscribe' },
      extra: { barberId },
    });
  }
}

/**
 * Loop 51 — channel renewal. Subscribe a new channel + stop the old
 * one in a single orchestration. Used by the daily renewal cron
 * (`/api/cron/google-channel-renew`) to rotate channels before the
 * ~30-day expiry kills them.
 *
 * Order matters: we subscribe NEW first, persist its columns,
 * THEN stop the old. If we stopped first and the new subscribe
 * failed, the barber's overlay would drop to 60s polling for a
 * window — by going new-first the worst case is two live channels
 * for a few seconds (both deliver the same notifications; the
 * handler dedupes by channel ID lookup).
 */
export async function renewBarberCalendarSubscription(barberId: string): Promise<void> {
  const url = webhookUrl();
  if (!url) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createSupabaseServiceRoleClient() as any;
  const res = await admin
    .from('barber_google_calendar')
    .select('refresh_token_enc, calendar_id, webhook_channel_id, webhook_resource_id, sync_status')
    .eq('barber_id', barberId)
    .maybeSingle();
  const row = res.data as {
    refresh_token_enc: string;
    calendar_id: string;
    webhook_channel_id: string | null;
    webhook_resource_id: string | null;
    sync_status: 'active' | 'paused' | 'error';
  } | null;
  if (!row || row.sync_status === 'paused') return;

  try {
    const refreshToken = decrypt(row.refresh_token_enc);
    const token = await refreshAccessToken(refreshToken);

    // Step 1 — new channel.
    const sub = await subscribeCalendarWatch({
      accessToken: token.access_token,
      calendarId: row.calendar_id,
      webhookUrl: url,
    });

    // Step 2 — persist new columns. Once this write lands, future
    // notifications route to the new channel ID; any in-flight
    // notification on the old channel still validates because the
    // OLD token is gone — but the handler silently drops mismatches
    // with 200, so no Google-side retry storm.
    await admin
      .from('barber_google_calendar')
      .update({
        webhook_channel_id: sub.channelId,
        webhook_resource_id: sub.resourceId,
        webhook_token: sub.channelToken,
        webhook_expires_at: sub.expirationAt,
      })
      .eq('barber_id', barberId);

    // Step 3 — politely stop the old channel. Best-effort: a
    // failure here just leaves an orphan channel on Google's side
    // that'll naturally expire within the original ~30-day window.
    if (row.webhook_channel_id && row.webhook_resource_id) {
      try {
        await stopCalendarWatch({
          accessToken: token.access_token,
          channelId: row.webhook_channel_id,
          resourceId: row.webhook_resource_id,
        });
      } catch (stopError) {
        captureException(stopError, {
          tags: { layer: 'google-sync', stage: 'renew-stop-old' },
          extra: { barberId, oldChannelId: row.webhook_channel_id },
        });
      }
    }
  } catch (e) {
    captureException(e, {
      tags: { layer: 'google-sync', stage: 'renew' },
      extra: { barberId },
    });
  }
}

export async function unsubscribeBarberCalendar(barberId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createSupabaseServiceRoleClient() as any;
  const res = await admin
    .from('barber_google_calendar')
    .select('refresh_token_enc, webhook_channel_id, webhook_resource_id')
    .eq('barber_id', barberId)
    .maybeSingle();
  const row = res.data as {
    refresh_token_enc: string;
    webhook_channel_id: string | null;
    webhook_resource_id: string | null;
  } | null;
  if (!row || !row.webhook_channel_id || !row.webhook_resource_id) return;
  try {
    const refreshToken = decrypt(row.refresh_token_enc);
    const token = await refreshAccessToken(refreshToken);
    await stopCalendarWatch({
      accessToken: token.access_token,
      channelId: row.webhook_channel_id,
      resourceId: row.webhook_resource_id,
    });
  } catch (e) {
    captureException(e, {
      tags: { layer: 'google-sync', stage: 'unsubscribe' },
      extra: { barberId },
    });
  } finally {
    // Whether the Google-side stop succeeded or not, clear the
    // columns locally so we don't try to renew a dead channel.
    try {
      await admin
        .from('barber_google_calendar')
        .update({
          webhook_channel_id: null,
          webhook_resource_id: null,
          webhook_token: null,
          webhook_expires_at: null,
        })
        .eq('barber_id', barberId);
    } catch {
      // Swallow — best-effort cleanup.
    }
  }
}
