-- =============================================================================
-- 20260525113202_notification_sends.sql
-- Phase 25c — Idempotence ledger for the reminders cron.
--
-- One row per (appointment_id, kind) pair. The cron writes to this table
-- AFTER a successful send; the next cron tick `INSERT … ON CONFLICT DO
-- NOTHING` blocks duplicates if the same window is scanned twice (which
-- happens at the 15-minute cron cadence when the appointment sits at the
-- exact boundary).
--
-- Booking confirmations + cancellations are NOT recorded here — they fire
-- directly from the related Server Action (where the duplicate concern
-- doesn't exist).
-- =============================================================================

create table if not exists public.notification_sends (
  id              uuid primary key default gen_random_uuid(),
  appointment_id  uuid not null references public.appointments(id) on delete cascade,
  kind            text not null check (kind in (
    'booking_confirmation',
    'reminder_24h',
    'reminder_1h',
    'cancellation',
    'birthday'
  )),
  /** Transport that handled the send ('shop-smtp' | 'resend' | 'noop'),
   *  surfaced for ops debugging. */
  via             text,
  sent_at         timestamptz not null default now(),
  unique (appointment_id, kind)
);

create index if not exists notification_sends_appt_idx
  on public.notification_sends (appointment_id);

-- RLS — managers can read for their own shop's appointments via a join.
alter table public.notification_sends enable row level security;
alter table public.notification_sends force row level security;

drop policy if exists notification_sends_select on public.notification_sends;
create policy notification_sends_select on public.notification_sends
  for select to authenticated
  using (
    exists (
      select 1 from public.appointments a
       where a.id = notification_sends.appointment_id
         and is_shop_member(a.shop_id)
    )
  );

-- Writes only via service-role (the cron runs as a Vercel function with
-- the service-role client). No policy needed — `force row level security`
-- without an INSERT/UPDATE policy means authenticated/anon can't write,
-- service-role bypasses RLS regardless.
