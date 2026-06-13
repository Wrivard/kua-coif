-- ---------------------------------------------------------------------------
-- FIN-BE-02 (Finances audit) — mark Stripe webhook events processed only AFTER
-- the handler succeeds.
--
-- stripe_events (20260528010000) used a single INSERT(event.id) as BOTH the
-- concurrency lock AND the "done" marker. If a handler failed transiently (DB
-- hiccup) on a MONEY event (e.g. charge.refunded / charge.dispute.*), the row
-- was already there, so Stripe's retry hit 23505 -> already_processed:200 and
-- the handler NEVER re-ran: the money event was lost for good (the reconcile
-- cron only covers pending bookings, not refunds/disputes).
--
-- Fix: keep the INSERT as the pre-handler advisory lock, but add processed_at,
-- set by /api/webhooks/stripe AFTER the handler completes. The webhook now
-- skips (already_processed) ONLY when processed_at is non-null; a row whose
-- processed_at is null is a lock from a delivery whose handler did not finish,
-- so the next Stripe retry re-processes it.
--
-- No backfill: existing rows keep processed_at NULL. Events that already
-- succeeded got a 200 and Stripe will not retry them, so they are never
-- re-evaluated (idempotence preserved). Events still inside Stripe's 3-day
-- retry window that were lost to the old bug are now correctly re-processed on
-- their next retry.
--
-- db/types.ts picks up processed_at on the next post-deploy `pnpm db:types`
-- regen (the repo's chore(db) convention); route.ts casts until then.
--
-- Re-runnable: `add column if not exists`.
-- ---------------------------------------------------------------------------

alter table public.stripe_events
  add column if not exists processed_at timestamptz;

comment on column public.stripe_events.processed_at is
  'FIN-BE-02 — set by /api/webhooks/stripe after the handler completes. NULL = a delivery locked the event id but its handler did not finish; the next Stripe retry re-processes it. The webhook skips (already_processed) only when this is non-null.';
