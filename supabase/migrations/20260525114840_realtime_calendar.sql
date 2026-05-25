-- =============================================================================
-- 20260525114840_realtime_calendar.sql
-- Phase 26 — Enable Supabase Realtime on the calendar tables.
--
-- Realtime works by attaching tables to the `supabase_realtime` PUBLICATION;
-- once a table is in there, every INSERT/UPDATE/DELETE generates a
-- broadcast that browser clients can subscribe to via
-- `supabase.channel().on('postgres_changes', ...)`.
--
-- The browser still has to authenticate (anon JWT minimum) and pass RLS
-- when subscribing — Realtime applies the same row-level policies as a
-- regular SELECT. We deliberately do NOT add tables containing PII the
-- shop doesn't already SELECT (e.g., audit_log) because subscribers would
-- effectively get a read-only firehose.
--
-- Idempotent: if the table is already in the publication, the ALTER is a
-- no-op-with-error which we catch.
-- =============================================================================

do $$
begin
  -- appointments → drives the calendar's main grid.
  begin
    execute 'alter publication supabase_realtime add table public.appointments';
  exception when duplicate_object then null;
  end;
  -- blocked_time → the red "barber unavailable" overlays.
  begin
    execute 'alter publication supabase_realtime add table public.blocked_time';
  exception when duplicate_object then null;
  end;
end$$;
