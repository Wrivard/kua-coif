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
  const res = await fetch(`${API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`, {
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
  });
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
  const res = await fetch(
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
  const res = await fetch(
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
  const res = await fetch(`${API_BASE}/freeBusy`, {
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
