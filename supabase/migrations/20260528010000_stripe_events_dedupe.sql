-- Phase B — webhook idempotency.
--
-- Stripe retries failed webhook deliveries up to 3 days. Without an
-- event-ID dedupe table, the same `payment_intent.succeeded` could
-- arrive twice and we'd re-apply the handler. Most of our handlers
-- are upserts so they're idempotent on the happy path — but
-- `charge.refunded` racing against a dashboard-initiated refund + a
-- `refundAppointment` action call could double-process.
--
-- Phase A's audit (commit 6657e89) flagged this as 🔴 must-fix.
--
-- Pattern: webhook does INSERT ... ON CONFLICT DO NOTHING into this
-- table BEFORE running the handler. If 0 rows inserted, we've already
-- processed this event; return 200 immediately. Otherwise the handler
-- runs exactly once.
--
-- We don't store the event payload — just the ID. The handler always
-- reads from `event.data.object` directly, and Stripe's docs guarantee
-- the same event ID maps to the same payload.

create table if not exists public.stripe_events (
  -- Stripe event ID format: `evt_*`. Comes from `event.id` on the
  -- webhook payload. PRIMARY KEY gives us the dedupe constraint
  -- for free.
  id text primary key,
  event_type text not null,
  received_at timestamptz not null default now()
);

-- Garbage collection is not automated — events are tiny (~80B per
-- row) and shop-volume is bounded, so a year of events is well under
-- 100MB. If retention becomes an issue, drop rows older than 30 days
-- (Stripe stops retrying at 3 days; anything older is safe to forget).
create index if not exists stripe_events_received_at_idx
  on public.stripe_events (received_at desc);

-- ── RLS ────────────────────────────────────────────────────────────
-- Service-role writes only (webhook handler). Read access is
-- granted to authenticated for debugging (super-admin would query
-- via service-role anyway).
alter table public.stripe_events enable row level security;
alter table public.stripe_events force row level security;

drop policy if exists stripe_events_select on public.stripe_events;
create policy stripe_events_select on public.stripe_events
  for select to authenticated
  using (false); -- block authenticated reads; debug queries use service-role

comment on table public.stripe_events is
  'Phase B — Stripe webhook event-ID dedupe. INSERT ON CONFLICT DO NOTHING in /api/webhooks/stripe before running each handler to guarantee at-most-once delivery semantics.';
