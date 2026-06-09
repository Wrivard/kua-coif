-- ---------------------------------------------------------------------------
-- Marketing opt-out / unsubscribe (Clients audit W6 — CASL + Loi 25).
--
-- The winback, birthday and review-request paths send commercial electronic
-- messages with NO consent gate and NO unsubscribe mechanism — a CASL
-- violation. CASL allows implied consent for an existing business
-- relationship (a client who booked), but every CEM must carry a working
-- unsubscribe and opt-outs must be honored.
--
-- Model: `marketing_opted_out` defaults false (implied consent from the
-- booking relationship). A signed unsubscribe link flips it true; the send
-- paths skip any client where it's true.
-- ---------------------------------------------------------------------------

alter table public.clients
  add column if not exists marketing_opted_out boolean not null default false;
