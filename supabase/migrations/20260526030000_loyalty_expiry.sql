-- Loop 35 (Phase 92 from AUDIT_PHASE70) — loyalty balance expiry.
--
-- Without an expiry, `clients.loyalty_balance_cents` accumulates
-- forever — a customer who earned a $10 reward in 2024 could redeem
-- it in 2030, by which point the shop has long forgotten and the
-- reward distorts the day's revenue (worse: the customer is no
-- longer an active customer, so the discount is just leakage).
--
-- Policy (V1):
--   * `loyalty_balance_expires_at` is set to `now() + 1 year` every
--     time a reward grant occurs. A regular customer extends their
--     expiry on every reward; an inactive customer's clock runs out.
--   * NULL means "no balance ever granted" (the column is added with
--     no default for that reason — a default of `now() + 1 year`
--     would mark fresh rows as already-expiring before any reward
--     was earned).
--   * Expiry is enforced lazily: the booking/lookup paths read the
--     column and treat balance as 0 when `expires_at < now()`. The
--     row is zeroed at first read after expiry so downstream
--     calculations stay consistent.
--
-- A future loop can add per-credit expiry (a `loyalty_credits` ledger
-- with FIFO consumption) if shops need finer control. Single-column
-- expiry is enough for V1.

alter table public.clients
  add column if not exists loyalty_balance_expires_at timestamptz;

comment on column public.clients.loyalty_balance_expires_at is
  'Timestamp after which loyalty_balance_cents is considered expired and treated as 0. '
  'Extended to now() + 1 year on every reward grant. NULL = no balance ever earned.';

-- Index helps a future cron sweep (Loop X — automated expiry email
-- reminder + nightly zero-out). For now the lazy check at lookup time
-- doesn't need it, but it's cheap to maintain and pays off the day we
-- want a `expires_at < now() + 30 days` query.
create index if not exists clients_loyalty_expires_at_idx
  on public.clients (loyalty_balance_expires_at)
  where loyalty_balance_cents > 0;
