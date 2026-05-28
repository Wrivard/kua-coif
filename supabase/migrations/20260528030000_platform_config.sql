-- Phase F — Küa-wide platform_config.
--
-- Today there is exactly one Küa instance, so we model the global
-- settings as a single-row table (PK = constant 1) rather than a config
-- record on another resource. This way RLS for "everyone vs super-admin"
-- is trivial and the helper code reads a single row by primary key.
--
-- app_fee_bps: basis points (100 = 1%) charged as `application_fee_amount`
-- on every Stripe Connect destination charge. 0 = no platform fee, which
-- is the V1 default (the user's explicit decision: "set 0% for now").
-- Stored in basis points (0–10000) so we have integer arithmetic up to
-- 100% without float drift.
--
-- The previous helper in lib/stripe/payments.ts read this from the
-- STRIPE_APP_FEE_BPS env var. After this migration that fallback only
-- kicks in when the DB read fails (graceful degradation); the
-- canonical source is the DB row.

create table if not exists public.platform_config (
  id integer primary key default 1,
  app_fee_bps integer not null default 0
    check (app_fee_bps >= 0 and app_fee_bps <= 10000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  -- Single-row guard: the CHECK + PK means only one row can ever
  -- exist. Inserts of id<>1 violate the check; duplicate id=1 inserts
  -- violate the primary key.
  constraint platform_config_single_row check (id = 1)
);

insert into public.platform_config (id, app_fee_bps)
values (1, 0)
on conflict (id) do nothing;

comment on table public.platform_config is
  'Phase F — Küa-wide settings. Single row (id=1) holds platform-level config like the application fee BPS. Read by lib/stripe/payments.ts on every PI mint.';
comment on column public.platform_config.app_fee_bps is
  'Application fee in basis points (100=1%). 0=no fee. Drives lib/stripe/payments.ts defaultApplicationFeeCents().';

-- RLS: only super-admins read + write. Service-role (used by the
-- booking flows / PI mint) bypasses RLS as usual.
alter table public.platform_config enable row level security;

drop policy if exists platform_config_kua_admin_read on public.platform_config;
create policy platform_config_kua_admin_read
  on public.platform_config for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_kua_admin = true
    )
  );

drop policy if exists platform_config_kua_admin_update on public.platform_config;
create policy platform_config_kua_admin_update
  on public.platform_config for update
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_kua_admin = true
    )
  );
