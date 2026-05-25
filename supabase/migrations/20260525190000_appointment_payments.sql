-- =============================================================================
-- 20260525190000_appointment_payments.sql
-- Phase 38 — Payment tracking on appointments.
--
-- Adds the minimum schema to mark an appointment as paid via Stripe.
-- The actual UI in booking wizard / appointment drawer is V1.1 work; this
-- migration unblocks the backend (Server Actions + webhook) so charges
-- can be tested before exposing them to end users.
--
-- Columns:
--   * payment_intent_id   — Stripe `pi_*` ID. Null until a deposit/charge
--                            is created. Unique partial index so the same
--                            intent can't accidentally tie to two rows.
--   * payment_status      — enum: 'unpaid' | 'pending' | 'paid' |
--                            'refunded' | 'failed'. Set by the Stripe
--                            webhook handler in
--                            /api/webhooks/stripe/route.ts.
--   * deposit_amount_cents — the agreed deposit at booking time (cents).
--                            Denormalized off `services.deposit_amount_cents`
--                            so historical appointments retain their
--                            charge amount even if the service price
--                            changes later.
--
-- Also adds `services.deposit_amount_cents` so a shop can require a
-- deposit per service (e.g., $30 for a haircut). 0 means "no deposit
-- required" — V1.1 booking flow gates the payment step on this value.
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'appointment_payment_status'
  ) then
    create type public.appointment_payment_status as enum (
      'unpaid',
      'pending',
      'paid',
      'refunded',
      'failed'
    );
  end if;
end$$;

alter table public.appointments
  add column if not exists payment_intent_id text,
  add column if not exists payment_status public.appointment_payment_status
    not null default 'unpaid',
  add column if not exists deposit_amount_cents integer not null default 0
    check (deposit_amount_cents >= 0);

alter table public.services
  add column if not exists deposit_amount_cents integer not null default 0
    check (deposit_amount_cents >= 0);

create unique index if not exists appointments_payment_intent_unique
  on public.appointments (payment_intent_id)
  where payment_intent_id is not null;

create index if not exists appointments_payment_status_idx
  on public.appointments (payment_status)
  where payment_status <> 'unpaid';

comment on column public.appointments.payment_intent_id is
  'Stripe PaymentIntent ID. Null until a deposit/charge is initiated.';
comment on column public.appointments.payment_status is
  'Lifecycle of the appointment payment. Driven by Stripe webhook events.';
comment on column public.appointments.deposit_amount_cents is
  'Snapshot of the deposit amount agreed at booking time (cents). Survives later service price changes.';
comment on column public.services.deposit_amount_cents is
  'Per-service deposit amount in cents. 0 = no deposit required.';
