-- ---------------------------------------------------------------------------
-- Bounded-query helpers for the birthday cron and the win-back page (plan 008).
--
-- PostgREST silently caps a single SELECT at db-max-rows (Supabase default
-- 1000). Two call sites fetched "all rows" and aggregated/filtered in JS, so
-- past the cap they truncated with no signal:
--
--   - the birthday cron pulled every DOB-bearing client per shop and matched
--     month/day in JS — clients past row 1000 never got a greeting, and the
--     clients_birthday_md_idx partial index was never used (no SQL predicate
--     referenced extract(month/day …)).
--   - the win-back page pulled a shop's ENTIRE appointment history and rolled
--     it up in JS — past the cap, active clients looked lapsed and got mass-
--     emailed.
--
-- Pushing the month/day match and the per-client rollup into SQL removes the
-- truncation (one row per client / only the matching rows leave Postgres) and
-- lets the index serve the birthday query.
--
-- Both are invoked only server-side (service-role): birthday_clients from the
-- birthday cron, client_activity from the manager-gated win-back page. They are
-- NOT SECURITY DEFINER (they run as the caller and read public.clients /
-- public.appointments, which the service-role bypasses RLS for), but we still
-- lock EXECUTE to service_role — same hardening pattern as
-- 20260609170000_lock_security_definer_functions.sql — so no anon/authenticated
-- web client can enumerate clients or activity by calling them directly.
-- ---------------------------------------------------------------------------

create or replace function public.birthday_clients(p_shop uuid, p_month int, p_day int)
returns setof public.clients
language sql stable as $$
  select * from public.clients
  where shop_id = p_shop
    and date_of_birth is not null
    and anonymized_at is null
    and marketing_opted_out = false
    and extract(month from date_of_birth) = p_month
    and extract(day from date_of_birth) = p_day
$$;
revoke execute on function public.birthday_clients(uuid, int, int) from public, anon, authenticated;
grant execute on function public.birthday_clients(uuid, int, int) to service_role;

create or replace function public.client_activity(p_shop uuid)
returns table(client_id uuid, last_active_at timestamptz, has_completed boolean)
language sql stable as $$
  select a.client_id,
         max(a.start_at) filter (where a.status not in ('cancelled','no_show')) as last_active_at,
         bool_or(a.status = 'completed') as has_completed
  from public.appointments a
  where a.shop_id = p_shop and a.client_id is not null
  group by a.client_id
$$;
revoke execute on function public.client_activity(uuid) from public, anon, authenticated;
grant execute on function public.client_activity(uuid) to service_role;
