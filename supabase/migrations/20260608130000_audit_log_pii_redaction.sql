-- ---------------------------------------------------------------------------
-- Audit-log PII redaction (final-audit fix #10).
--
-- public.tg_audit_log (20260523000003) writes a FULL row snapshot —
-- to_jsonb(new) / to_jsonb(old) — into audit_log.diff for every change on the
-- sensitive tables. That persists raw client PII (email / phone / notes) and
-- owner financial PII (legal_name / dob / destination_last4 /
-- destination_bank_name) at rest, indefinitely, with no redaction — a
-- Loi 25 / data-minimization risk.
--
-- This replaces the trigger function so the snapshot MASKS those columns to
-- "[redacted]" before insertion. The audit still records who changed which
-- entity, when, and which non-sensitive fields moved — it just no longer
-- stores the raw sensitive VALUES. A null stays null (so "was empty" is still
-- distinguishable from "[redacted]").
--
-- NOTE (still open, needs a business decision): RETENTION. This redacts new
-- writes but does not purge OLD rows or cap audit_log age. Pick a retention
-- window (Loi 25 = "as long as necessary") and add a scheduled purge; and
-- backfill-redact existing rows if required. Out of scope here.
--
-- `create or replace` — re-runnable; no trigger re-attach needed (the
-- triggers already point at this function name).
-- ---------------------------------------------------------------------------

-- Mask the given top-level keys of a jsonb object to "[redacted]" (non-null
-- values only). Non-object input (e.g. json null on INSERT's OLD) passes
-- through untouched.
create or replace function public._audit_redact_keys(p jsonb, p_keys text[])
returns jsonb
language sql
immutable
as $$
  select case
    when jsonb_typeof(p) is distinct from 'object' then p
    else coalesce(
      (
        select jsonb_object_agg(
          k,
          case
            when k = any(p_keys) and v <> 'null'::jsonb then to_jsonb('[redacted]'::text)
            else v
          end
        )
        from jsonb_each(p) as e(k, v)
      ),
      p
    )
  end;
$$;

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
      (v_old ->> 'shop_id')::uuid
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
    v_new := public._audit_redact_keys(v_new, array['email', 'phone', 'notes']);
    v_old := public._audit_redact_keys(v_old, array['email', 'phone', 'notes']);
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
