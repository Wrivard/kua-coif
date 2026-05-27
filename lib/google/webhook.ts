/**
 * Loop 50 (Phase 97 from AUDIT_PHASE70) — Google Calendar webhook
 * subscription helpers. Plain-fetch against the events.watch +
 * channels.stop endpoints. Caller is responsible for resolving the
 * fresh access_token (via `refreshAccessToken` in google/sync.ts).
 *
 * Docs:
 *   https://developers.google.com/calendar/api/v3/reference/events/watch
 *   https://developers.google.com/calendar/api/v3/reference/channels/stop
 */

import { randomUUID } from 'node:crypto';

const API_BASE = 'https://www.googleapis.com/calendar/v3';

export type WatchResponse = {
  /** UUID we generated and Google echoes back. Becomes our routing key. */
  channelId: string;
  /** Per-channel secret Google echoes via X-Goog-Channel-Token. */
  channelToken: string;
  /** Opaque ID returned by Google. Required to stop the channel later. */
  resourceId: string;
  /** Channel expiration in ISO; Google caps at ~30 days from creation. */
  expirationAt: string;
};

/**
 * Subscribe to a calendar's events.watch. `webhookUrl` must be a
 * publicly-reachable HTTPS endpoint — Google rejects HTTP and any
 * IP-literal host. Returns the subscription metadata that the
 * caller persists on barber_google_calendar.
 */
export async function subscribeCalendarWatch({
  accessToken,
  calendarId,
  webhookUrl,
}: {
  accessToken: string;
  calendarId: string;
  webhookUrl: string;
}): Promise<WatchResponse> {
  // Random UUIDs for both — Google echoes channelId on every
  // notification (used as DB lookup key), token validates that the
  // notification came from a channel we actually subscribed (a
  // missing/wrong token = silently drop).
  const channelId = randomUUID();
  const token = randomUUID();

  const res = await fetch(`${API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/watch`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: channelId,
      type: 'web_hook',
      address: webhookUrl,
      token,
      // Default expiration is ~7 days. Max is ~30 days. We don't
      // set it explicitly — the renewal cron (future loop) will
      // refresh well before expiry regardless.
    }),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`[google] events.watch failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    id: string;
    resourceId: string;
    expiration?: string; // ms since epoch as a string
  };
  // Google returns `expiration` as a stringified ms timestamp. If
  // absent (rare — some calendars) OR malformed, default to 7 days
  // out so the renewal cron still picks it up at a sensible time.
  // Loop 50 self-review — the old ternary checked truthiness of the
  // string but didn't guard against `Number()` returning NaN, which
  // would have thrown at `new Date(NaN).toISOString()`.
  const parsedMs = data.expiration ? Number(data.expiration) : NaN;
  const expirationAt = Number.isFinite(parsedMs)
    ? new Date(parsedMs).toISOString()
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  return {
    channelId: data.id,
    channelToken: token,
    resourceId: data.resourceId,
    expirationAt,
  };
}

/**
 * Stop a channel subscription. Called when a barber disconnects or
 * when a stale channel is replaced by a fresh one. 404 / 410 are
 * treated as success — the channel was already gone.
 */
export async function stopCalendarWatch({
  accessToken,
  channelId,
  resourceId,
}: {
  accessToken: string;
  channelId: string;
  resourceId: string;
}): Promise<void> {
  const res = await fetch(`${API_BASE}/channels/stop`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id: channelId, resourceId }),
    cache: 'no-store',
  });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`[google] channels.stop failed: ${res.status} ${await res.text()}`);
  }
}
