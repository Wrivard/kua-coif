-- Loop 50 (Phase 97 from AUDIT_PHASE70) — Google Calendar two-way
-- sync via webhook.
--
-- Until now the FreeBusy overlay on the calendar polled Google
-- every 60s (unstable_cache TTL). A real-time webhook makes events
-- booked from outside Küa show up instantly on the busy overlay.
--
-- Google's `events.watch` model:
--   1. We POST to /events/watch with our HTTPS URL + a channel
--      token (per-connection secret).
--   2. Google returns a channel ID + resource ID + expiration
--      (max 30 days).
--   3. Google POSTs to our webhook URL whenever the calendar
--      changes. The body is empty; the X-Goog headers identify
--      which channel fired.
--   4. We re-fetch FreeBusy server-side and bust our cache.
--   5. Channels auto-expire — a renewal cron (deferred to a
--      follow-up loop) re-subscribes before expiry.
--
-- New columns on `barber_google_calendar`:
--   * webhook_channel_id — UUID we generate per subscription; sent
--     as X-Goog-Channel-ID by Google on every notification so we
--     can route back to the right barber.
--   * webhook_resource_id — opaque ID Google assigns; required when
--     we call channels.stop to unsubscribe.
--   * webhook_token — per-channel shared secret. Google echoes it
--     back as X-Goog-Channel-Token on each notification; we
--     reject anything that doesn't match.
--   * webhook_expires_at — when does this channel die. A future
--     renewal cron uses this column to find subscriptions due for
--     refresh.
--
-- All four are nullable: a barber's row can exist without a
-- subscription (legacy connections, or shops that haven't enabled
-- webhook sync yet).
--
-- Idempotent.

alter table public.barber_google_calendar
  add column if not exists webhook_channel_id text,
  add column if not exists webhook_resource_id text,
  add column if not exists webhook_token text,
  add column if not exists webhook_expires_at timestamptz;

comment on column public.barber_google_calendar.webhook_channel_id is
  'UUID per Google Calendar events.watch subscription. Echoed back as X-Goog-Channel-ID by the webhook; used to route notifications.';
comment on column public.barber_google_calendar.webhook_resource_id is
  'Opaque resource ID returned by events.watch. Required to call channels.stop on unsubscribe.';
comment on column public.barber_google_calendar.webhook_token is
  'Per-channel shared secret. Google echoes it as X-Goog-Channel-Token; we reject mismatches.';
comment on column public.barber_google_calendar.webhook_expires_at is
  'When the current channel subscription expires (Google caps at ~30 days). Future cron renews before expiry.';

-- Channel ID is the primary lookup path on the webhook hot path.
-- Unique because Google guarantees one channel ID per subscription.
create unique index if not exists barber_google_calendar_webhook_channel_idx
  on public.barber_google_calendar (webhook_channel_id)
  where webhook_channel_id is not null;

-- Renewal cron will scan WHERE webhook_expires_at < now() + interval '2 days'.
create index if not exists barber_google_calendar_webhook_expires_idx
  on public.barber_google_calendar (webhook_expires_at)
  where webhook_expires_at is not null;

-- Reads of the secret should stay service-role-only — anyone with
-- the token can spoof a notification.
revoke select (webhook_token) on public.barber_google_calendar from authenticated, anon;
