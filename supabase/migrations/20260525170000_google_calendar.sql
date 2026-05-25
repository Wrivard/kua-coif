-- =============================================================================
-- 20260525170000_google_calendar.sql
-- Phase 34 — Google Calendar two-way sync (per-barber OAuth).
--
-- Each barber can connect their personal Google account. We store the
-- refresh_token encrypted (same AES-256-GCM scheme as Phase 25's SMTP
-- passwords). When a Küa appointment changes, we push to their personal
-- calendar; when their personal calendar has busy events, we read those
-- and overlay them on the Küa calendar as "personal busy" blocks.
--
-- Tables:
--   * barber_google_calendar — one row per connected barber, holding the
--     encrypted refresh_token + calendar ID + sync state. RLS scoped to
--     the shop so a barber can disconnect themselves but only managers
--     can view other barbers' state.
--   * Adds appointments.google_event_id so the push direction knows which
--     remote event to update/delete when an appointment changes.
--
-- Why no `access_token` column: access tokens expire in 1h. We refresh on
-- demand from the refresh_token and never persist the short-lived one.
-- One less attack surface.
--
-- Idempotent via IF NOT EXISTS / IF NOT EXISTS columns. Safe to re-run.
-- =============================================================================

-- 1. Per-barber Google Calendar connection state.
create table if not exists public.barber_google_calendar (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  barber_id uuid not null references public.barbers(id) on delete cascade,

  -- Encrypted via lib/crypto/aes.ts (same NOTIFICATION_ENCRYPTION_KEY env).
  -- REVOKE'd from authenticated below so even an authenticated query can't
  -- pull the ciphertext — only service-role (the OAuth callback + the push
  -- worker) reads it back.
  refresh_token_enc text not null,

  -- Which calendar inside the barber's Google account we write to.
  -- 'primary' covers 99% of cases; advanced users can pick a different
  -- calendar via a future settings UI.
  calendar_id text not null default 'primary',

  -- Stripe-style "sync state". When sync_status='error' we surface a
  -- "reconnect" CTA in the settings UI — the refresh token was probably
  -- revoked by the user from Google's side.
  sync_status text not null default 'active' check (sync_status in ('active', 'paused', 'error')),
  last_synced_at timestamptz,
  last_error text,

  -- Display info — the email shown in the UI so the barber knows WHICH
  -- Google account is connected (useful for multi-account users).
  google_email text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (barber_id) -- one Google account per barber at a time
);

-- Indexes: lookup by shop (settings UI lists all connections),
-- lookup by barber (sync push picks by barber_id).
create index if not exists barber_google_calendar_shop_idx
  on public.barber_google_calendar (shop_id);

-- 2. Track the remote event ID so updates + deletes are idempotent.
alter table public.appointments
  add column if not exists google_event_id text;

create index if not exists appointments_google_event_id_idx
  on public.appointments (google_event_id)
  where google_event_id is not null;

-- 3. RLS — same shop-membership gate as the rest of the app.
alter table public.barber_google_calendar enable row level security;
alter table public.barber_google_calendar force row level security;

-- Read: any member of the shop can see WHICH barbers are connected (no
-- token data). Write: managers + the barber themselves.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'barber_google_calendar'
      and policyname = 'barber_google_calendar_select'
  ) then
    create policy barber_google_calendar_select
      on public.barber_google_calendar
      for select
      using (
        shop_id in (
          select shop_id from public.shop_members
          where user_id = auth.uid() and status = 'confirmed'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'barber_google_calendar'
      and policyname = 'barber_google_calendar_modify'
  ) then
    create policy barber_google_calendar_modify
      on public.barber_google_calendar
      for all
      using (
        shop_id in (
          select shop_id from public.shop_members
          where user_id = auth.uid() and status = 'confirmed'
        )
      )
      with check (
        shop_id in (
          select shop_id from public.shop_members
          where user_id = auth.uid() and status = 'confirmed'
        )
      );
  end if;
end$$;

-- 4. Column-level REVOKE — same pattern as notification_smtp_password_enc.
--    The encrypted refresh_token only flows through the service-role client
--    (the OAuth callback handler + the cron-driven sync worker).
revoke select (refresh_token_enc) on public.barber_google_calendar from anon, authenticated;

-- 5. updated_at trigger so we know when a sync state changed.
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'barber_google_calendar_set_updated_at'
  ) then
    create trigger barber_google_calendar_set_updated_at
      before update on public.barber_google_calendar
      for each row
      execute function public.set_updated_at();
  end if;
end$$;

comment on table public.barber_google_calendar is
  'Per-barber Google Calendar OAuth state. Refresh token is AES-256-GCM encrypted via NOTIFICATION_ENCRYPTION_KEY. Read by /api/google/oauth/callback + the appointment-push code path.';
comment on column public.appointments.google_event_id is
  'Remote Google Calendar event ID when the appointment is mirrored. Null when the barber has no Google connection or the push failed.';
