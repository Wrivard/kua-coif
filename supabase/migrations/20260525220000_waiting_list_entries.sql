-- Phase 53 — Waiting list entries.
--
-- The shop-side `waiting_list_config` table (enabled + threshold_hours)
-- has existed since Phase 2 but had no companion entries table. This
-- migration adds it so the booking wizard can capture a client's
-- preferences when no slot is available and the admin can work through
-- the queue manually.
--
-- The notification flow (auto-email when a slot opens) is V1.1 — for
-- V1 the admin sees the list, manually phones/emails the client, then
-- marks the entry 'notified' or 'cancelled'.

create table public.waiting_list_entries (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,

  -- Client contact (we DON'T link to the clients table — entries can be
  -- from someone who has never booked. If a matching client exists,
  -- admin can manually associate via UI later).
  first_name text not null,
  last_name text,
  email text,
  phone text not null,

  -- Preferences. Barber + services are nullable so the entry can mean
  -- "any barber, any service" (rare) or anything in between.
  preferred_barber_id uuid references public.barbers(id) on delete set null,
  service_ids uuid[] default array[]::uuid[],
  date_window_start date not null,
  date_window_end date not null,
  notes text,

  -- Lifecycle.
  status text not null default 'waiting'
    check (status in ('waiting', 'notified', 'booked', 'cancelled')),
  locale text not null default 'fr' check (locale in ('fr', 'en')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  notified_at timestamptz,

  -- Sanity: window must be non-empty.
  check (date_window_end >= date_window_start)
);

create index waiting_list_entries_shop_status_idx
  on public.waiting_list_entries (shop_id, status, created_at desc);

create index waiting_list_entries_window_idx
  on public.waiting_list_entries (shop_id, date_window_start, date_window_end)
  where status = 'waiting';

-- updated_at trigger — matches the convention used by other tables
-- (set by public.tg_set_updated_at on UPDATE).
create trigger waiting_list_entries_set_updated_at
  before update on public.waiting_list_entries
  for each row execute function public.tg_set_updated_at();

alter table public.waiting_list_entries enable row level security;

-- Shop members can read & manage entries for their shop. Public
-- booking inserts go through the service-role client so they bypass
-- RLS — no anon insert policy needed.
create policy waiting_list_entries_select on public.waiting_list_entries
  for select to authenticated
  using (
    shop_id in (
      select shop_id from public.shop_members
      where user_id = auth.uid() and status = 'confirmed'
    )
  );

create policy waiting_list_entries_update on public.waiting_list_entries
  for update to authenticated
  using (
    shop_id in (
      select shop_id from public.shop_members
      where user_id = auth.uid() and status = 'confirmed'
    )
  )
  with check (
    shop_id in (
      select shop_id from public.shop_members
      where user_id = auth.uid() and status = 'confirmed'
    )
  );

create policy waiting_list_entries_delete on public.waiting_list_entries
  for delete to authenticated
  using (
    shop_id in (
      select shop_id from public.shop_members
      where user_id = auth.uid() and status = 'confirmed'
    )
  );

comment on table public.waiting_list_entries is
  'Phase 53 — Booking wizard waitlist entries. Captured when no slot is available; admin works the queue manually until V1.1 notification automation.';
