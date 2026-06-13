-- ---------------------------------------------------------------------------
-- Loi 25 (MED-3) — redact the client NAME in audit_log snapshots.
--
-- 20260613150000 (the current tg_audit_log) redacts the clients branch to
-- ['email','phone','notes','date_of_birth'] but leaves first_name / last_name
-- in the before/after snapshot, so a client's NAME persists in audit_log.diff
-- indefinitely — and outlives anonymization (the audit row predates / survives
-- the clients-row wipe). This re-creates the trigger function with the three
-- name keys added to the clients branch ONLY. The companion app change
-- (anonymizeClient) scrubs the name from HISTORICAL rows; this stops new ones.
--
-- Byte-identical to 20260613150000 EXCEPT the clients redaction array:
--   ['email','phone','notes','date_of_birth']
--     + ['first_name','last_name','client_name_snapshot']
-- (client_name_snapshot is an appointments column — a harmless no-op on a
--  clients row, kept for symmetry with the appointments branch / defense.)
--
-- `create or replace` on the function only; the audit_log_<table> triggers
-- already point at this name, so no re-attach (mirrors 20260609120000). No
-- other branch/table touched.
-- ---------------------------------------------------------------------------

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
      -- `shops` is the tenant root: no shop_id column, its `id` IS the shop id.
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
    -- MED-3 — first_name/last_name added so the client name no longer lands in
    -- audit_log.diff. client_name_snapshot is a no-op here (appointments col).
    v_new := public._audit_redact_keys(
      v_new,
      array['email', 'phone', 'notes', 'date_of_birth', 'first_name', 'last_name',
            'client_name_snapshot']);
    v_old := public._audit_redact_keys(
      v_old,
      array['email', 'phone', 'notes', 'date_of_birth', 'first_name', 'last_name',
            'client_name_snapshot']);
  elsif TG_TABLE_NAME = 'payment_profiles' then
    v_new := public._audit_redact_keys(
      v_new, array['legal_name', 'dob', 'destination_last4', 'destination_bank_name']);
    v_old := public._audit_redact_keys(
      v_old, array['legal_name', 'dob', 'destination_last4', 'destination_bank_name']);
  elsif TG_TABLE_NAME = 'appointments' then
    v_new := public._audit_redact_keys(v_new, array['notes', 'client_name_snapshot']);
    v_old := public._audit_redact_keys(v_old, array['notes', 'client_name_snapshot']);
  elsif TG_TABLE_NAME = 'shops' then
    -- shops carries the encrypted QuickBooks refresh token (a secret) and the
    -- Stripe/QB financial bindings. Mask the VALUES; the key stays so "this
    -- column changed" is still visible in the diff.
    v_new := public._audit_redact_keys(
      v_new, array['stripe_account_id', 'quickbooks_realm_id', 'quickbooks_refresh_token_enc']);
    v_old := public._audit_redact_keys(
      v_old, array['stripe_account_id', 'quickbooks_realm_id', 'quickbooks_refresh_token_enc']);
  elsif TG_TABLE_NAME = 'waiting_list_entries' then
    -- waiting-list entries hold raw client PII (Loi 25) for people who may never
    -- have booked. Mirror the clients redaction set.
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
