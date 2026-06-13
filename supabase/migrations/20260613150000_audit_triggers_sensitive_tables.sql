-- ---------------------------------------------------------------------------
-- Durable audit triggers on sensitive money/config tables (THEME 2 — phantom
-- audit; findings SM-02 / SOP-07). The "trigger" half of the theme; the
-- "logDurableAudit" half (non-trigger-able tables like auth.users + service-
-- role actor attribution) is a separate T2b lot.
--
-- These tables carry `logAuditAction(...)` calls in their Server Actions, but
-- `logAuditAction` is a runtime NO-OP (its user-session insert is dropped by
-- audit_log RLS — see CLAUDE.md §3). They had NO `tg_audit_log` trigger, so a
-- change to a tax RATE, a loyalty reward amount, a shop's settings, a promo
-- automation, etc. left ZERO durable trail. The existing trigger-captured
-- tables (clients, appointments, discounts, promo_codes, commission_tiers,
-- payment_profiles, shop_members, barbers, products*, services*) stay as-is;
-- this adds the same AFTER trigger to the seven that were still uncovered.
--
-- platform_config is deliberately EXCLUDED: it already has a dedicated
-- append-only history (platform_config_history, written by the
-- updatePlatformAppFee action) and no logAuditAction site.
--
-- ⚠ Two of the seven need the shared tg_audit_log function re-created (below),
--    BOTH carried over from / additive to the existing redaction logic
--    (20260608130000, 20260609120000):
--   1. shops has NO shop_id column (it IS the tenant root, id = shop id), so
--      without a special case its audit rows would land shop_id=NULL and never
--      surface in the per-shop /settings/audit-log view. We derive shop_id from
--      id for the shops table.
--   2. shops carries the encrypted QuickBooks refresh token + Stripe/QB
--      financial bindings, and waiting_list_entries carries raw client PII
--      (Loi 25) for people who may never have booked. A full-row snapshot would
--      persist those VALUES in audit_log.diff — masked here like clients /
--      payment_profiles already are. The key is kept, only the value is
--      "[redacted]", so "this column changed" remains visible.
--
-- actor_id = auth.uid() → NULL under the service-role client (only RLS is
-- bypassed by service-role, triggers still fire). The mutation IS recorded;
-- service-role actor attribution is T2b.
--
-- Re-runnable: `create or replace` on the function; `drop trigger if exists`
-- before each `create trigger`.
-- ---------------------------------------------------------------------------

-- Re-create tg_audit_log with (1) shops shop_id-from-id derivation and
-- (2) redaction branches for shops + waiting_list_entries. Everything else is
-- identical to 20260609120000 (the prior definition).
create or replace function public.tg_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop_id uuid;
  v_entity_id text;
  v_diff jsonb;
  v_new jsonb := to_jsonb(new);
  v_old jsonb := to_jsonb(old);
begin
  -- Try to derive shop_id from row data; fall back to NULL.
  begin
    v_shop_id := coalesce(
      (v_new ->> 'shop_id')::uuid,
      (v_old ->> 'shop_id')::uuid,
      -- T2a — `shops` is the tenant root: no shop_id column, its `id` IS the
      -- shop id. Without this, shops audit rows land shop_id=NULL and never
      -- show in the per-shop /settings/audit-log view.
      case
        when TG_TABLE_NAME = 'shops'
          then coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid)
      end
    );
  exception when others then
    v_shop_id := null;
  end;

  v_entity_id := coalesce(
    (v_new ->> 'id'),
    (v_old ->> 'id')
  );

  -- Redact sensitive columns per table before snapshotting.
  if TG_TABLE_NAME = 'clients' then
    v_new := public._audit_redact_keys(v_new, array['email', 'phone', 'notes', 'date_of_birth']);
    v_old := public._audit_redact_keys(v_old, array['email', 'phone', 'notes', 'date_of_birth']);
  elsif TG_TABLE_NAME = 'payment_profiles' then
    v_new := public._audit_redact_keys(
      v_new, array['legal_name', 'dob', 'destination_last4', 'destination_bank_name']);
    v_old := public._audit_redact_keys(
      v_old, array['legal_name', 'dob', 'destination_last4', 'destination_bank_name']);
  elsif TG_TABLE_NAME = 'appointments' then
    v_new := public._audit_redact_keys(v_new, array['notes', 'client_name_snapshot']);
    v_old := public._audit_redact_keys(v_old, array['notes', 'client_name_snapshot']);
  elsif TG_TABLE_NAME = 'shops' then
    -- T2a — shops carries the encrypted QuickBooks refresh token (a secret)
    -- and the Stripe/QB financial bindings. Mask the VALUES; the key stays so
    -- "this column changed" is still visible in the diff.
    v_new := public._audit_redact_keys(
      v_new, array['stripe_account_id', 'quickbooks_realm_id', 'quickbooks_refresh_token_enc']);
    v_old := public._audit_redact_keys(
      v_old, array['stripe_account_id', 'quickbooks_realm_id', 'quickbooks_refresh_token_enc']);
  elsif TG_TABLE_NAME = 'waiting_list_entries' then
    -- T2a — waiting-list entries hold raw client PII (Loi 25) for people who
    -- may never have booked. Mirror the clients redaction set.
    v_new := public._audit_redact_keys(
      v_new, array['first_name', 'last_name', 'email', 'phone', 'notes']);
    v_old := public._audit_redact_keys(
      v_old, array['first_name', 'last_name', 'email', 'phone', 'notes']);
  end if;

  v_diff := case TG_OP
    when 'INSERT' then jsonb_build_object('after',  v_new)
    when 'UPDATE' then jsonb_build_object('before', v_old, 'after', v_new)
    when 'DELETE' then jsonb_build_object('before', v_old)
  end;

  insert into public.audit_log (shop_id, actor_id, action, entity, entity_id, diff)
  values (v_shop_id, auth.uid(), lower(TG_OP), TG_TABLE_NAME, v_entity_id, v_diff);

  return coalesce(new, old);
end;
$$;

-- Attach the trigger to the seven previously-uncovered sensitive tables.
-- Money/config first, then the rest. Mirrors the existing audit_log_<table>
-- naming + AFTER INSERT/UPDATE/DELETE shape (20260523000003:169-195).

drop trigger if exists audit_log_taxes on public.taxes;
create trigger audit_log_taxes
  after insert or update or delete on public.taxes
  for each row execute procedure public.tg_audit_log();

drop trigger if exists audit_log_loyalty_program on public.loyalty_program;
create trigger audit_log_loyalty_program
  after insert or update or delete on public.loyalty_program
  for each row execute procedure public.tg_audit_log();

drop trigger if exists audit_log_waiting_list_config on public.waiting_list_config;
create trigger audit_log_waiting_list_config
  after insert or update or delete on public.waiting_list_config
  for each row execute procedure public.tg_audit_log();

drop trigger if exists audit_log_waiting_list_entries on public.waiting_list_entries;
create trigger audit_log_waiting_list_entries
  after insert or update or delete on public.waiting_list_entries
  for each row execute procedure public.tg_audit_log();

drop trigger if exists audit_log_reviews on public.reviews;
create trigger audit_log_reviews
  after insert or update or delete on public.reviews
  for each row execute procedure public.tg_audit_log();

drop trigger if exists audit_log_notification_automations on public.notification_automations;
create trigger audit_log_notification_automations
  after insert or update or delete on public.notification_automations
  for each row execute procedure public.tg_audit_log();

-- shops: AFTER audit coexists with FIN-BE-01's BEFORE UPDATE guard
-- (shops_guard_financial_columns, 20260613140000) — BEFORE validates, the row
-- writes, then this AFTER trigger records. Multiple BEFORE+AFTER on one table
-- is fine; they don't interfere.
drop trigger if exists audit_log_shops on public.shops;
create trigger audit_log_shops
  after insert or update or delete on public.shops
  for each row execute procedure public.tg_audit_log();
