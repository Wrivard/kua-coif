-- =============================================================================
-- 20260525160000_stripe_connect.sql
-- Phase 28 — Stripe Connect Express onboarding columns on `shops`.
--
-- Two columns get added:
--   * stripe_account_id     — the `acct_*` ID Stripe returns at creation.
--                              Nullable until the shop starts onboarding.
--   * stripe_connect_status — derived from the Stripe account's
--                              `charges_enabled` / `payouts_enabled` flags.
--                              Kept locally so the UI can render the badge
--                              without hitting Stripe on every render.
--                              Enum kept narrow on purpose; webhook handler
--                              writes one of these four values.
--
-- No `payment_profiles` change — that table is the V1 mock view and is now
-- effectively deprecated for shops that go through Stripe Connect. It stays
-- around in case we want to render legacy data, but new shops flow through
-- the Stripe-driven `/settings/payments` UI exclusively.
--
-- RLS / column-level access:
--   * `stripe_account_id` is non-sensitive (it's a public account ID) but we
--     keep it behind the same shop-membership RLS as the rest of `shops`.
--   * `stripe_connect_status` is purely display info — same gating.
--
-- Idempotent via `IF NOT EXISTS` so re-running the migration is safe.
-- =============================================================================

-- 1. The enum. `not_started` is the implicit default for every existing row.
do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'stripe_connect_status'
  ) then
    create type public.stripe_connect_status as enum (
      'not_started',
      'pending',      -- onboarding link generated, KYC in progress
      'restricted',   -- Stripe accepted account but some requirement is pending
      'active'        -- charges_enabled AND payouts_enabled both true
    );
  end if;
end$$;

-- 2. The columns.
alter table public.shops
  add column if not exists stripe_account_id text,
  add column if not exists stripe_connect_status public.stripe_connect_status
    not null default 'not_started';

-- 3. Unique index — one Stripe account per shop. Partial index so multiple
--    NULL values stay allowed during the "not connected yet" phase.
create unique index if not exists shops_stripe_account_id_unique
  on public.shops (stripe_account_id)
  where stripe_account_id is not null;

-- 4. Comment for future archaeology — the next contributor reading these
--    columns will see the design intent without spelunking the PR.
comment on column public.shops.stripe_account_id is
  'Stripe Connect Express account ID (acct_*). Null until shop starts onboarding.';
comment on column public.shops.stripe_connect_status is
  'Cached Stripe account state. Updated by the account.updated webhook in /api/webhooks/stripe.';
