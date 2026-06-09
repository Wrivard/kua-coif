-- ---------------------------------------------------------------------------
-- Audit-log: redact clients.date_of_birth (Clients audit fix).
--
-- 20260608130000 added PII redaction to tg_audit_log but the clients column
-- list omitted date_of_birth, so a client's raw DOB was still snapshotted
-- into audit_log.diff on every insert/update/delete — a Loi 25 PII-at-rest
-- leak. This re-creates the trigger function with date_of_birth added to the
-- clients redaction set. Everything else is identical to 20260608130000.
--
-- `create or replace` — re-runnable, no trigger re-attach needed.
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
  begin
    v_shop_id := coalesce(
      (v_new ->> 'shop_id')::uuid,
      (v_old ->> 'shop_id')::uuid
    );
  exception when others then
    v_shop_id := null;
  end;

  v_entity_id := coalesce((v_new ->> 'id'), (v_old ->> 'id'));

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
