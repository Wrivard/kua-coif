-- POS-lite stage 2 — record HOW a collected payment was taken.
--
-- payment_method ∈ {card_online, card_counter, cash}. NULL = legacy row
-- (predates this column) or not-yet-collected. Counter cash sales set
-- payment_status='paid' + payment_method='cash' (cash model A, plan 028 §1).
--
-- Nullable, no default, NO backfill: the finances/today drawer carries a
-- legacy-compat clause (method IS NULL AND status='unpaid' still counts as
-- drawer cash) so historical rows need no data migration (plan 028 §5).
-- No RLS change (same row, existing appointments policies); no index (the
-- only consumer is the already day-bounded finances/today set).
create type payment_method as enum ('card_online', 'card_counter', 'cash');

alter table public.appointments
  add column if not exists payment_method payment_method;
