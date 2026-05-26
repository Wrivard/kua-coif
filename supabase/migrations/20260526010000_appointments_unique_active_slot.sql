-- Phase 70 audit P2.16 — race condition on slot booking.
--
-- Two clients hitting "Book 2pm Tuesday" at the same second both pass
-- `checkAvailability()` (no row exists at that slot yet) and both
-- INSERT succeed. Barber wakes up to a double-booked calendar.
--
-- Partial UNIQUE index on (barber_id, start_at) WHERE status NOT IN
-- ('cancelled', 'no_show') so:
--   - Active appointments serialize on the slot at the DB layer.
--   - Cancelled / no-show rows don't block re-booking the slot (which
--     is what shop owners want — the customer flaked, free up the time).
--
-- Second INSERT throws unique_violation (Postgres error 23505); the
-- booking action catches that and returns CONFLICT, same code path
-- as `checkAvailability` would have returned synchronously.

create unique index if not exists appointments_active_barber_slot_idx
  on public.appointments (barber_id, start_at)
  where status not in ('cancelled', 'no_show');

comment on index public.appointments_active_barber_slot_idx is
  'Phase 70 audit P2.16 — serialize concurrent bookings on the same barber+slot. Cancelled / no-show rows excluded so re-booking is allowed.';
