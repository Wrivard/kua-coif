-- =============================================================================
-- 20260608120000_calendar_replica_identity_full.sql
-- Calendar audit #4 — REPLICA IDENTITY FULL on the realtime calendar tables.
--
-- Supabase Realtime's `postgres_changes` payload only includes the PRIMARY
-- KEY in the `old` record for UPDATE/DELETE unless the table is REPLICA
-- IDENTITY FULL. The calendar's client-side date-intersection gate
-- (appointments-calendar.tsx, audit #4) needs the OLD row's start_at/end_at
-- to tell whether a reschedule/cancel MOVED a block out of the
-- currently-viewed day — so it can skip the full ~9-query refresh when both
-- the old and new positions are off-screen.
--
-- Without this the gate degrades SAFELY (it can still gate INSERTs precisely
-- and conservatively refreshes on every UPDATE/DELETE); FULL is what lets it
-- gate those two event types precisely too.
--
-- Cost: UPDATE/DELETE now log the full OLD row image to WAL. These tables are
-- small and low-write (a salon's appointment churn is a handful of rows per
-- minute), so the extra WAL volume is negligible. `ALTER ... REPLICA
-- IDENTITY FULL` is idempotent (a no-op when already FULL).
--
-- ⚠️ REVIEW + STAGING before prod, like the other audit migrations.
-- =============================================================================

alter table public.appointments replica identity full;
alter table public.blocked_time replica identity full;
