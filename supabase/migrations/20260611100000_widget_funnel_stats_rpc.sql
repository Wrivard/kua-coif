-- Plan 038 (PERF-03) — aggregate the widget funnel in SQL.
--
-- /settings/widget used to pull up to 20,000 raw widget_events rows into
-- Node just to compute four numbers, and the cap silently TRUNCATED the
-- rollup — wrong conversion stats exactly when the widget succeeds. This
-- RPC returns the grouped counts (event_type × source) for one shop over
-- a window; the page sums a handful of rows instead.
--
-- SECURITY INVOKER on purpose: the function runs with the caller's RLS,
-- so a shop member only ever aggregates rows the widget_events select
-- policies already grant them (member of the shop, or super-admin).
-- STABLE: pure read within one statement.

create or replace function public.widget_funnel_stats(p_shop_id uuid, p_since timestamptz)
returns table (event_type text, source text, event_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select we.event_type, we.source, count(*)::bigint as event_count
  from public.widget_events we
  where we.shop_id = p_shop_id
    and we.occurred_at >= p_since
  group by we.event_type, we.source
$$;

comment on function public.widget_funnel_stats(uuid, timestamptz) is
  'Plan 038 — grouped widget_events counts (event_type x source) for one shop since a timestamp. SECURITY INVOKER: caller''s RLS decides visibility.';
