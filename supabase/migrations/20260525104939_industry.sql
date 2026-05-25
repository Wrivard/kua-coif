-- =============================================================================
-- 20260525104939_industry.sql
-- Phase 23 — Multi-vertical support: each shop declares its industry, the
-- catalog (categories + services) is seeded from a per-industry template at
-- shop creation, and the UI can hide industry-irrelevant features.
--
-- We use a Postgres enum rather than a free-form text column so:
--   - the value set is documented + enforced at the schema layer;
--   - the TypeScript codegen produces a discriminated union, not just `string`;
--   - new verticals require an explicit migration (each addition is a
--     conscious product decision, not a typo by an admin).
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'industry_kind') then
    create type industry_kind as enum (
      'hair_salon',
      'barbershop',
      'massage',
      'physio',
      'chiropractic',
      'esthetics'
    );
  end if;
end$$;

alter table public.shops
  add column if not exists industry industry_kind not null default 'hair_salon';

comment on column public.shops.industry is
  'Picked at shop-creation time. Drives the default catalog seed + feature flags (e.g., hide retail products for therapy verticals). Editable but not exposed in V1 admin UI — change requires migration of existing rows.';
