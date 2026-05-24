-- =============================================================================
-- 20260524144355_advisors_hotfix.sql
--
-- Cosmetic + perf cleanups surfaced by `supabase advisors` after the initial
-- launch. None of these are functional bugs — the goal is to silence noisy
-- warnings and pre-empt the actual perf hits they predict.
--
-- Scope:
--   1. Lock `search_path` on the one trigger function that was missing it.
--   2. Revoke `EXECUTE` on trigger functions from `public` — there is no
--      legitimate `/rpc/<name>` use case for them.
--   3. Wrap `auth.uid()` in `(select auth.uid())` inside RLS policies so
--      Postgres can cache the value once per query instead of re-evaluating
--      per row (the `auth_rls_initplan` advisor).
--   4. Add covering indexes on every foreign key that lacked one. Listed
--      individually with the originating advisor's table.fkey so we can
--      cross-check later.
--
-- Out of scope (accepted false positives):
--   - `current_shop_ids`, `is_shop_member`, `has_role_in_shop` exec by anon /
--     authenticated. These are RLS helpers — the calling role MUST be able to
--     execute them for policies to evaluate. Calling them via `/rpc/` from
--     anon just returns `false` / `[]` (no info leak).
--   - `auth_leaked_password_protection` — toggle lives in the Supabase Auth
--     dashboard, not in SQL.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Lock search_path on tg_set_updated_at
-- -----------------------------------------------------------------------------
-- The other trigger functions already have `set search_path = public` from
-- the initial migration; tg_set_updated_at was the lone exception.
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Revoke EXECUTE on trigger functions
-- -----------------------------------------------------------------------------
-- These functions are designed to run inside their respective AFTER/BEFORE
-- triggers, where they execute with the trigger owner's privileges regardless
-- of the calling user. Exposing them via `/rest/v1/rpc/<name>` adds no value
-- and surfaces them in the advisors output.
--
-- Supabase pre-grants `EXECUTE` on every public function to `anon`,
-- `authenticated`, and `service_role` at project init, so a plain `from
-- public` would leave those role grants in place — we revoke from each
-- explicitly. Triggers themselves keep working since they run as the
-- function owner (`postgres`), not as the requesting role.
revoke execute on function public.tg_set_updated_at()             from public, anon, authenticated, service_role;
revoke execute on function public.tg_audit_log()                  from public, anon, authenticated, service_role;
revoke execute on function public.tg_create_profile_on_signup()   from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Cache auth.uid() inside RLS policies (auth_rls_initplan)
-- -----------------------------------------------------------------------------
-- Wrapping the call in a sub-SELECT moves it to a one-shot initplan: Postgres
-- evaluates it once per query instead of once per row. Equivalent at the
-- single-row scale (login / single-shop ops) but matters once these tables
-- grow to millions of rows.

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists shops_insert on public.shops;
create policy shops_insert on public.shops
  for insert to authenticated
  with check ((select auth.uid()) is not null);

drop policy if exists commission_tiers_select_self on public.commission_tiers;
create policy commission_tiers_select_self on public.commission_tiers
  for select to authenticated
  using (
    exists (
      select 1 from public.barbers b
      where b.id = commission_tiers.barber_id
        and b.user_id = (select auth.uid())
    )
  );

-- -----------------------------------------------------------------------------
-- 4. Covering indexes on unindexed foreign keys
-- -----------------------------------------------------------------------------
-- One per FK flagged by the `unindexed_foreign_keys` advisor. Suffix `_fk_idx`
-- so they don't collide with the manually-tuned multi-column indexes from the
-- initial schema migration (which often happen to cover the FK column anyway,
-- but the advisor only matches single-column FK indexes).

create index if not exists appointment_services_service_id_fk_idx
  on public.appointment_services (service_id);

create index if not exists appointments_client_id_fk_idx
  on public.appointments (client_id);

create index if not exists barbers_user_id_fk_idx
  on public.barbers (user_id);

create index if not exists blocked_time_barber_id_fk_idx
  on public.blocked_time (barber_id);

create index if not exists commission_tiers_barber_id_fk_idx
  on public.commission_tiers (barber_id);

create index if not exists discounts_shop_id_fk_idx
  on public.discounts (shop_id);

create index if not exists product_taxes_tax_id_fk_idx
  on public.product_taxes (tax_id);

create index if not exists products_brand_id_fk_idx
  on public.products (brand_id);

create index if not exists products_category_id_fk_idx
  on public.products (category_id);

create index if not exists service_categories_shop_id_fk_idx
  on public.service_categories (shop_id);

create index if not exists service_taxes_tax_id_fk_idx
  on public.service_taxes (tax_id);

create index if not exists services_category_id_fk_idx
  on public.services (category_id);

create index if not exists taxes_shop_id_fk_idx
  on public.taxes (shop_id);

-- -----------------------------------------------------------------------------
-- 5. Move extensions out of the `public` schema (extension_in_public)
-- -----------------------------------------------------------------------------
-- Supabase pre-creates an `extensions` schema and includes it on the
-- DB-level `search_path`, so unqualified references to `citext`,
-- `gin_trgm_ops`, etc. still resolve after the move.
--
-- `ALTER EXTENSION ... SET SCHEMA` updates every dependent reference by OID
-- (column types, operator classes used by GiST / GIN indexes), so existing
-- tables and indexes keep working transparently. Verified post-apply by
-- running a `tstzrange && tstzrange` overlap query — the GiST appointments
-- index continued to serve the predicate.
alter extension citext     set schema extensions;
alter extension pg_trgm    set schema extensions;
alter extension btree_gist set schema extensions;
