-- =============================================================================
-- 20260613140000_shops_lock_financial_columns_owner_only.sql
-- Security FIN-BE-01 (Finances audit) — column-lock the financial / credential
-- columns of `shops` to owner + service-role.
--
-- The `shops_update` RLS policy (20260523000002_rls.sql:43-45) only gates on
-- `has_role_in_shop(id,'manager')`, and Postgres has NO per-column RLS. So a
-- MANAGER, via PostgREST `PATCH /rest/v1/shops`, could rewrite:
--   - stripe_account_id            → the PaymentIntent `transfer_data.destination`;
--                                    every future charge of the salon would route
--                                    to the attacker's Express account = FUND THEFT
--   - stripe_connect_status        → payment-routing state
--   - payment_mode                 → encaissement policy (full/deposit/none)
--   - quickbooks_realm_id          \  the QuickBooks credential binding +
--   - quickbooks_refresh_token_enc /  encrypted refresh token
--
-- RLS can't express a per-column rule, but a BEFORE UPDATE trigger can — and a
-- trigger fires EVEN under the service-role client (only RLS is bypassed by
-- service-role, not triggers). Hence the explicit carve-out below.
--
-- Carve-out — who writes these columns LEGITIMATELY:
--   EVERY legitimate writer goes through the SERVICE-ROLE client (auth.uid()
--   IS NULL): Stripe Connect onboarding + status refresh + payment-mode + QB
--   disconnect (settings/payments/actions.ts, all via the `admin` client), the
--   QB OAuth callback (api/quickbooks/oauth/callback), the Stripe webhook
--   (api/webhooks/stripe), and the QB refresh cron. No user-session flow writes
--   them. So `auth.uid() IS NULL` lets every legitimate write pass untouched.
--   The owner allowance (has_role_in_shop(NEW.id,'owner')) is defense-in-depth
--   for any FUTURE owner user-session flow — it never fires for today's flows.
--   A manager / barber user-session is the only actor blocked.
--
-- Companion to the manager->owner shop_members lockdown (20260613120000).
-- =============================================================================

create or replace function public.tg_shops_guard_financial_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service-role / cron / webhooks run with no user JWT → auth.uid() IS NULL.
  -- Every legitimate write of the guarded columns goes through service-role.
  if auth.uid() is null then
    return new;
  end if;

  -- The shop owner may change them too (defense-in-depth; today every legit
  -- write is service-role, so this branch never fires for current flows).
  if public.has_role_in_shop(new.id, 'owner') then
    return new;
  end if;

  -- Otherwise (manager / barber user-session): block changes to the financial
  -- + credential columns. FIN-BE-01 — stripe_account_id is the PaymentIntent
  -- destination, so a manager rewriting it = fund theft.
  if new.stripe_account_id is distinct from old.stripe_account_id
     or new.stripe_connect_status is distinct from old.stripe_connect_status
     or new.payment_mode is distinct from old.payment_mode
     or new.quickbooks_realm_id is distinct from old.quickbooks_realm_id
     or new.quickbooks_refresh_token_enc is distinct from old.quickbooks_refresh_token_enc
  then
    raise exception
      'FIN-BE-01: only the shop owner or service-role may change financial/credential columns (stripe_account_id, stripe_connect_status, payment_mode, quickbooks_realm_id, quickbooks_refresh_token_enc) on shops'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists shops_guard_financial_columns on public.shops;

create trigger shops_guard_financial_columns
  before update on public.shops
  for each row execute procedure public.tg_shops_guard_financial_columns();

comment on function public.tg_shops_guard_financial_columns() is
  'FIN-BE-01 — blocks a non-owner user-session (manager/barber) from changing the financial/credential columns of shops: stripe_account_id, stripe_connect_status, payment_mode, quickbooks_realm_id, quickbooks_refresh_token_enc. Service-role (auth.uid() IS NULL, every legitimate writer) and the shop owner pass. Companion to the manager->owner shop_members lockdown (20260613120000).';
