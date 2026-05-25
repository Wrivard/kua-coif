-- =============================================================================
-- 20260525210000_loyalty_counters.sql
-- Phase 43 — Loyalty program activation.
--
-- The `loyalty_program` table + the /settings/loyalty UI have existed
-- since Phase 6, but no logic actually granted rewards. This migration
-- adds the per-client counters that the new `awardLoyaltyOnCompletion`
-- helper (lib/business/loyalty.ts) writes against.
--
-- Two columns on `clients`:
--   * loyalty_counter        — number of qualifying transactions toward
--                              the next reward. Resets to 0 when the
--                              goal is reached and the reward is granted.
--   * loyalty_balance_cents  — accumulated reward balance in cents.
--                              Applied as a discount on future
--                              appointments (V1.1 booking-flow
--                              integration; for V1 the manager applies
--                              manually).
--
-- Both default to 0 with a CHECK so they can't go negative — a buggy
-- update can't put a client in "owes the shop loyalty" state.
-- =============================================================================

alter table public.clients
  add column if not exists loyalty_counter integer not null default 0
    check (loyalty_counter >= 0),
  add column if not exists loyalty_balance_cents integer not null default 0
    check (loyalty_balance_cents >= 0);

comment on column public.clients.loyalty_counter is
  'Number of qualifying transactions toward the next reward. Reset to 0 when goal is reached and reward awarded.';
comment on column public.clients.loyalty_balance_cents is
  'Accumulated reward balance in cents. Applied as a discount on future appointments (V1.1 booking UI integration).';
