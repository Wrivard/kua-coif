-- ---------------------------------------------------------------------------
-- Audit-log retention (final-audit fix #10, part 2).
--
-- Companion to 20260608130000 (PII redaction): that masks sensitive VALUES in
-- new audit rows; this caps how long ANY audit row is kept. Loi 25 =
-- "personal info kept only as long as necessary". A purge function +
-- monthly pg_cron job enforce a rolling window.
--
-- RETENTION WINDOW: 24 months (below). Adjust by re-scheduling with a
-- different argument, e.g.:
--   select cron.schedule('purge-audit-log', '0 3 1 * *',
--                         $$ select public.purge_old_audit_log(12); $$);
-- Disable entirely with:  select cron.unschedule('purge-audit-log');
--
-- SAFETY: the function only deletes audit_log rows older than the window
-- (today the oldest row is weeks old, so it deletes nothing yet — this is a
-- forward-looking policy). It never touches business tables.
--
-- Idempotent: create extension if-not-exists, create-or-replace function,
-- and cron.schedule(name, ...) upserts by job name.
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;

create or replace function public.purge_old_audit_log(retain_months int default 24)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from public.audit_log
  where occurred_at < now() - make_interval(months => retain_months);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Run at 03:00 on the 1st of every month. Named job → re-running this
-- migration replaces (does not duplicate) the schedule.
select cron.schedule(
  'purge-audit-log',
  '0 3 1 * *',
  $$ select public.purge_old_audit_log(24); $$
);
