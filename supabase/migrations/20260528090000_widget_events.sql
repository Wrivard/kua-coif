-- Phase H+14 — widget analytics events.
--
-- Every embed widget mount + step transition + completion + abandon
-- gets a row here. The data feeds the conversion-funnel card on
-- /settings/widget so the operator can answer "how many people see
-- my widget and how many actually book?" — the V1 signal everybody
-- wants before sinking $$ into marketing.
--
-- Insert is PUBLIC: any visitor on a salon site can POST an event
-- through `/api/widget/event`. The API validates `shopSlug` exists +
-- the enum fields before writing. Reads are RLS-gated: shop owners
-- see their own shop's events, super-admins see everything.
--
-- Storage shape:
--   - One row per event (impression / step_view / booking_complete /
--     abandon). No JSON soup: enums for `event_type` + `source` +
--     `step_kind` make rollups cheap.
--   - `session_id` is a UUID generated client-side per widget mount
--     so we can stitch a single visitor's journey (impression →
--     step_views → complete | abandon).
--   - `meta jsonb` is a small escape hatch for future per-event
--     extras without a migration.

create table if not exists public.widget_events (
  id bigserial primary key,
  shop_id uuid not null references public.shops(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  event_type text not null check (
    event_type in ('impression', 'step_view', 'booking_complete', 'abandon')
  ),
  step_kind text check (
    step_kind is null
    or step_kind in ('service', 'barber', 'slot', 'contact', 'done')
  ),
  session_id text not null,
  source text not null check (source in ('inline', 'floating-button', 'modal', 'direct')),
  meta jsonb not null default '{}'::jsonb
);

-- Two indexes the funnel rollup hits hard:
--   1. (shop_id, occurred_at desc) — the per-shop "last 30 days"
--      window scan + sort.
--   2. (session_id) — used to dedupe + stitch a single visitor's
--      journey. session_id is unique-per-mount, not unique in the
--      table (each event in the same session shares it).
create index if not exists widget_events_shop_id_occurred_at_idx
  on public.widget_events (shop_id, occurred_at desc);

create index if not exists widget_events_session_id_idx
  on public.widget_events (session_id);

alter table public.widget_events enable row level security;

-- Public insert. The API route validates input + resolves shop_id
-- from the alias, so we don't expose a "spam any shop_id" surface
-- through this policy.
drop policy if exists widget_events_public_insert on public.widget_events;
create policy widget_events_public_insert
  on public.widget_events for insert
  with check (true);

-- Shop members can read events for their shops.
drop policy if exists widget_events_shop_read on public.widget_events;
create policy widget_events_shop_read
  on public.widget_events for select
  using (
    exists (
      select 1 from public.shop_members
      where shop_members.shop_id = widget_events.shop_id
        and shop_members.user_id = (select auth.uid())
    )
  );

-- Super-admins see everything.
drop policy if exists widget_events_kua_admin_read on public.widget_events;
create policy widget_events_kua_admin_read
  on public.widget_events for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid()) and profiles.is_kua_admin = true
    )
  );

comment on table public.widget_events is
  'Phase H+14 — widget analytics: one row per impression / step_view / booking_complete / abandon. Public insert via /api/widget/event; reads RLS-gated to shop members + super-admins.';
