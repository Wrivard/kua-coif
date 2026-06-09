-- ---------------------------------------------------------------------------
-- Clients de-duplication foundation (Clients audit W4).
--
-- Two problems this addresses:
--  1. Public booking matched clients by a phone SUBSTRING (ilike '%digits%')
--     on the raw, un-normalized phone column → a formatted-phone client
--     ('+1 514…') didn't match a bare-digits rebooking (duplicate), and a
--     substring could resolve to the WRONG client (cross-client PII/loyalty
--     leak). A canonical phone key fixes both with an exact match.
--  2. No way to resolve existing duplicates → a transactional merge.
--
-- `phone_normalized` is a STORED generated column = the last 10 digits of the
-- phone (NANP canonical: strips formatting + a leading country-code 1, so
-- '+1 514 699 4290' and '5146994290' both key to '5146994290'). Indexed for
-- exact-match find-or-create + the merge. NOT made UNIQUE: existing shops
-- already hold duplicate rows and legitimately-shared phones exist; dedup is
-- enforced app-side on create + resolved via merge_clients.
-- ---------------------------------------------------------------------------

alter table public.clients
  add column if not exists phone_normalized text
  generated always as (right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10)) stored;

create index if not exists clients_shop_phone_norm_idx
  on public.clients (shop_id, phone_normalized)
  where phone_normalized <> '';

create index if not exists clients_shop_email_lower_idx
  on public.clients (shop_id, lower(email))
  where email is not null;

-- merge_clients: fold p_merge INTO p_keep atomically — re-point every inbound
-- reference, combine loyalty, backfill any contact field the kept client is
-- missing, then delete the merged row. SECURITY DEFINER + shop-scoped: both
-- clients must belong to p_shop or it raises. The whole body runs in one
-- implicit transaction, so a partial merge can't leave dangling refs.
create or replace function public.merge_clients(p_keep uuid, p_merge uuid, p_shop uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_merge public.clients;
begin
  if p_keep = p_merge then
    raise exception 'merge_clients: keep and merge are the same client';
  end if;
  if not exists (select 1 from public.clients where id = p_keep and shop_id = p_shop) then
    raise exception 'merge_clients: keep client % not in shop %', p_keep, p_shop;
  end if;
  select * into v_merge from public.clients where id = p_merge and shop_id = p_shop;
  if not found then
    raise exception 'merge_clients: merge client % not in shop %', p_merge, p_shop;
  end if;

  -- Re-point all inbound references (appointments is FK RESTRICT, so this
  -- MUST happen before the delete below).
  update public.appointments set client_id = p_keep where client_id = p_merge;
  update public.reviews set client_id = p_keep where client_id = p_merge;
  update public.client_marketing_sends set client_id = p_keep where client_id = p_merge;

  -- Combine loyalty (both records are the same person) + backfill contact.
  update public.clients set
    loyalty_balance_cents = coalesce(loyalty_balance_cents, 0) + coalesce(v_merge.loyalty_balance_cents, 0),
    loyalty_counter = coalesce(loyalty_counter, 0) + coalesce(v_merge.loyalty_counter, 0),
    loyalty_balance_expires_at = greatest(loyalty_balance_expires_at, v_merge.loyalty_balance_expires_at),
    email = coalesce(email, v_merge.email),
    phone = coalesce(phone, v_merge.phone),
    date_of_birth = coalesce(date_of_birth, v_merge.date_of_birth),
    notes = case
      when coalesce(notes, '') = '' then v_merge.notes
      when coalesce(v_merge.notes, '') = '' then notes
      else notes || E'\n---\n' || v_merge.notes
    end
  where id = p_keep;

  -- The merged client now has no inbound references → safe to delete.
  delete from public.clients where id = p_merge;
end;
$$;
