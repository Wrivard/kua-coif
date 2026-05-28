-- Phase H+6 — log every change to platform_config.app_fee_bps.
--
-- The Phase F single-row platform_config (id=1) stores the CURRENT
-- value, but a Küa team member auditing fee changes ("when did we
-- bump from 0% to 1%? who changed it?") had no answer. This table is
-- the append-only history log: each `updatePlatformAppFee` Server
-- Action saves a row before mutating the live config.
--
-- RLS-gated to super-admins like the rest of the platform_config
-- surface.

create table if not exists public.platform_config_history (
  id uuid primary key default gen_random_uuid(),
  changed_at timestamptz not null default now(),
  changed_by uuid references public.profiles(id) on delete set null,
  old_app_fee_bps integer not null check (old_app_fee_bps >= 0 and old_app_fee_bps <= 10000),
  new_app_fee_bps integer not null check (new_app_fee_bps >= 0 and new_app_fee_bps <= 10000),
  note text
);

create index if not exists platform_config_history_changed_at_idx
  on public.platform_config_history (changed_at desc);

alter table public.platform_config_history enable row level security;

drop policy if exists platform_config_history_kua_admin_read on public.platform_config_history;
create policy platform_config_history_kua_admin_read
  on public.platform_config_history for select
  using (
    exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and is_kua_admin = true
    )
  );

-- Seed with the current value so the history isn't empty on first
-- view. Note column references "initial value when history table was
-- created" since no real change actually happened.
insert into public.platform_config_history (old_app_fee_bps, new_app_fee_bps, note)
select 0, app_fee_bps, 'Initial value at history table creation (Phase H+6)'
from public.platform_config where id = 1;

comment on table public.platform_config_history is
  'Phase H+6 — append-only log of every platform_config.app_fee_bps change. Inserted by the updatePlatformAppFee Server Action before mutating the live row. Super-admin gated by RLS.';
