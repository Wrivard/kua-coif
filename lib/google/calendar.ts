/**
 * Google Calendar API helpers — Phase 34.
 *
 * All operations take a fresh access_token. The caller is responsible
 * for refreshing it via `refreshAccessToken(refresh_token)` immediately
 * before calling — we don't cache access_tokens because they expire in
 * 1h and the refresh call is cheap (~50ms).
 *
 * REST docs: https://developers.google.com/calendar/api/v3/reference/events
 *
 * Why no SDK: every endpoint is a single fetch with JSON body. The
 * `googleapis` package adds ~1MB to our bundle for these four calls.
 */

const API_BASE = 'https://www.googleapis.com/calendar/v3';

export type GoogleCalendarEvent = {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
  status: 'confirmed' | 'tentative' | 'cancelled';
  htmlLink?: string;
};

/**
 * Loop 36 (P96) — exponential backoff for Google Calendar API calls.
 *
 * Google's quota responses (429 `userRateLimitExceeded`,
 * `rateLimitExceeded`) and transient 5xx errors should be retried
 * instead of bubbling up as hard failures. Without this, a quota
 * burst on a busy shop's morning would mark every barber's
 * `last_sync_error_at` red even though Google would have served the
 * call moments later.
 *
 * Strategy:
 *   - Up to 3 attempts (initial + 2 retries)
 *   - Backoff: 500ms, 1500ms — well under our 5s server-action
 *     latency budget even in the worst case
 *   - Retry on 429, 500, 502, 503, 504 (transient)
 *   - Honour `Retry-After` header when present (Google sometimes
 *     sends it on 429)
 *   - Pass through anything else (auth errors, malformed payloads —
 *     retrying won't help)
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  { maxAttempts = 3 }: { maxAttempts?: number } = {},
): Promise<Response> {
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) return res;
    const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
    if (!retryable || attempt === maxAttempts - 1) {
      return res;
    }
    // Drain the body so the connection can be released — fetch doesn't
    // auto-close when we ignore the body.
    await res.text().catch(() => '');
    lastResponse = res;
    const retryAfter = res.headers.get('retry-after');
    const headerMs = retryAfter ? Number(retryAfter) * 1000 : NaN;
    const backoffMs =
      Number.isFinite(headerMs) && headerMs > 0 ? headerMs : 500 * (attempt + 1) ** 2;
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }
  // Unreachable but TS doesn't know — the loop always returns or sleeps.
  return lastResponse!;
}

/**
 * Create an event on a Google Calendar. Returns the new event ID which
 * the caller stores on `appointments.google_event_id`.
 */
export async function createEvent({
  accessToken,
  calendarId,
  event,
}: {
  accessToken: string;
  calendarId: string;
  event: {
    summary: string;
    description?: string;
    startIso: string;
    endIso: string;
    timeZone: string;
  };
}): Promise<GoogleCalendarEvent> {
  const res = await fetchWithRetry(
    `${API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: event.summary,
        description: event.description,
        start: { dateTime: event.startIso, timeZone: event.timeZone },
        end: { dateTime: event.endIso, timeZone: event.timeZone },
      }),
      cache: 'no-store',
    },
  );
  if (!res.ok) {
    throw new Error(`[google] createEvent failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as GoogleCalendarEvent;
}

/**
 * Update an existing event (idempotent — passes the full new state).
 */
export async function updateEvent({
  accessToken,
  calendarId,
  eventId,
  event,
}: {
  accessToken: string;
  calendarId: string;
  eventId: string;
  event: {
    summary: string;
    description?: string;
    startIso: string;
    endIso: string;
    timeZone: string;
  };
}): Promise<GoogleCalendarEvent> {
  const res = await fetchWithRetry(
    `${API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: event.summary,
        description: event.description,
        start: { dateTime: event.startIso, timeZone: event.timeZone },
        end: { dateTime: event.endIso, timeZone: event.timeZone },
      }),
      cache: 'no-store',
    },
  );
  if (!res.ok) {
    throw new Error(`[google] updateEvent failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as GoogleCalendarEvent;
}

/**
 * Delete an event. 410 Gone is treated as success (the event was already
 * deleted from Google's side — the user may have removed it manually).
 */
export async function deleteEvent({
  accessToken,
  calendarId,
  eventId,
}: {
  accessToken: string;
  calendarId: string;
  eventId: string;
}): Promise<void> {
  const res = await fetchWithRetry(
    `${API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    },
  );
  if (!res.ok && res.status !== 410 && res.status !== 404) {
    throw new Error(`[google] deleteEvent failed: ${res.status} ${await res.text()}`);
  }
}

export type FreeBusyPeriod = { start: string; end: string };

/**
 * Fetch the barber's busy periods in a time window. Used by the calendar
 * page to overlay "personal busy" blocks alongside Küa appointments.
 *
 * `freebusy.query` is cheaper than `events.list` because Google does the
 * aggregation server-side — we don't pay for event detail we don't need.
 */
export async function fetchBusyPeriods({
  accessToken,
  calendarId,
  timeMin,
  timeMax,
}: {
  accessToken: string;
  calendarId: string;
  timeMin: string;
  timeMax: string;
}): Promise<FreeBusyPeriod[]> {
  const res = await fetchWithRetry(`${API_BASE}/freeBusy`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      items: [{ id: calendarId }],
    }),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`[google] freeBusy failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    calendars?: Record<string, { busy?: FreeBusyPeriod[]; errors?: unknown[] }>;
  };
  return data.calendars?.[calendarId]?.busy ?? [];
}
