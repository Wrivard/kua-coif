-- =============================================================================
-- 20260525180000_quickbooks.sql
-- Phase 35 — QuickBooks Online Payments as an alternative to Stripe.
--
-- Shops can pick EITHER Stripe OR QuickBooks (or neither) for payments.
-- The settings UI shows the active choice and disables the other; an
-- explicit "switch processor" flow is V1.5+.
--
-- Why a separate column for QB realm_id rather than reusing the
-- stripe_connect_status enum: QB's status semantics differ (active /
-- expired / disconnected — no equivalent of Stripe's "restricted").
-- Keeping the enums separate avoids cross-product confusion.
--
-- Idempotent.
-- =============================================================================

-- Enum for QuickBooks connection state.
do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'quickbooks_connect_status'
  ) then
    create type public.quickbooks_connect_status as enum (
      'not_started',
      'active',        -- access + refresh tokens valid
      'expired',       -- refresh token expired (100 days idle) — needs reconnect
      'disconnected'   -- user disconnected from their QuickBooks side
    );
  end if;
end$$;

alter table public.shops
  add column if not exists quickbooks_realm_id text,
  add column if not exists quickbooks_refresh_token_enc text,
  add column if not exists quickbooks_connect_status public.quickbooks_connect_status
    not null default 'not_started';

-- Unique partial index — one QuickBooks realm per shop, multiple NULLs
-- allowed during the "not connected" phase.
create unique index if not exists shops_quickbooks_realm_unique
  on public.shops (quickbooks_realm_id)
  where quickbooks_realm_id is not null;

-- The encrypted refresh token must NEVER leak via a normal authenticated
-- SELECT. Service-role is the only path that decrypts it.
revoke select (quickbooks_refresh_token_enc) on public.shops from anon, authenticated;

comment on column public.shops.quickbooks_realm_id is
  'QuickBooks Online "realm ID" (company ID). Null until shop connects via OAuth.';
comment on column public.shops.quickbooks_refresh_token_enc is
  'AES-256-GCM encrypted QuickBooks refresh_token. Refresh tokens expire after 100 days of idleness.';
comment on column public.shops.quickbooks_connect_status is
  'Cached QuickBooks connection state. Updated by /api/webhooks/quickbooks + the refresh-on-401 path.';
