-- =============================================================================
-- 20260523000003_indexes_triggers.sql
-- Performance indexes, updated_at triggers, audit_log triggers.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------

-- shop_members lookups (RLS helper queries by user_id constantly)
create index shop_members_user_idx on public.shop_members (user_id);
create index shop_members_shop_idx on public.shop_members (shop_id);

-- barbers
create index barbers_shop_status_sort_idx
  on public.barbers (shop_id, status, sort_order);

-- services
create index services_shop_status_sort_idx
  on public.services (shop_id, status, sort_order);
create index services_shop_category_idx
  on public.services (shop_id, category_id);

-- products
create index products_shop_idx on public.products (shop_id);
create index products_shop_brand_idx on public.products (shop_id, brand_id);
create index products_shop_category_idx on public.products (shop_id, category_id);
-- Low-stock dashboards run frequently: index lets us scan inventory cheaply.
create index products_shop_inventory_idx on public.products (shop_id, current_inventory);

-- clients — phone/email dedup + trigram search on names.
create index clients_shop_idx on public.clients (shop_id);
create index clients_shop_phone_idx on public.clients (shop_id, lower(phone));
create index clients_shop_email_idx on public.clients (shop_id, lower(email::text));
create index clients_name_trgm_idx
  on public.clients using gin (
    (lower(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))) gin_trgm_ops
  );

-- appointments — calendar queries and overlap checks.
create index appointments_shop_start_idx
  on public.appointments (shop_id, start_at);
create index appointments_barber_start_idx
  on public.appointments (barber_id, start_at);
create index appointments_shop_status_idx
  on public.appointments (shop_id, status);
-- For "give me everything happening between start_at and end_at": gist range.
create index appointments_barber_range_idx
  on public.appointments using gist (
    barber_id, tstzrange(start_at, end_at, '[)')
  );

-- blocked_time
create index blocked_time_shop_idx on public.blocked_time (shop_id);
create index blocked_time_barber_range_idx
  on public.blocked_time using gist (
    coalesce(barber_id, '00000000-0000-0000-0000-000000000000'::uuid),
    tstzrange(start_at, end_at, '[)')
  );

-- promo_codes — quick lookup by code at booking time.
create index promo_codes_shop_code_idx
  on public.promo_codes (shop_id, lower(code));

-- audit_log — most common query is "what changed for this shop lately?"
create index audit_log_shop_time_idx
  on public.audit_log (shop_id, occurred_at desc);
create index audit_log_entity_idx
  on public.audit_log (entity, entity_id, occurred_at desc);

-- =============================================================================
-- updated_at auto-update
-- =============================================================================
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Apply to every table that owns an `updated_at` column.
do $$
declare
  t text;
  has_col boolean;
begin
  for t in
    select unnest(array[
      'profiles',
      'shops','shop_hours','shop_days_off','shop_members',
      'barbers','barber_settings',
      'taxes',
      'service_categories','services',
      'product_brands','product_categories','products',
      'clients',
      'appointments',
      'discounts','promo_codes','loyalty_program',
      'commission_tiers','tips_config',
      'payment_profiles','notification_prefs','waiting_list_config'
    ])
  loop
    -- Only attach if the table actually has updated_at (defensive).
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'updated_at'
    ) into has_col;
    if has_col then
      execute format(
        'create trigger set_updated_at before update on public.%I
         for each row execute procedure public.tg_set_updated_at();',
        t
      );
    end if;
  end loop;
end$$;

-- =============================================================================
-- audit_log triggers on sensitive tables
-- =============================================================================
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
begin
  -- Try to derive shop_id from row data; fall back to NULL.
  begin
    v_shop_id := coalesce(
      (to_jsonb(new) ->> 'shop_id')::uuid,
      (to_jsonb(old) ->> 'shop_id')::uuid
    );
  exception when others then
    v_shop_id := null;
  end;

  v_entity_id := coalesce(
    (to_jsonb(new) ->> 'id'),
    (to_jsonb(old) ->> 'id')
  );

  v_diff := case TG_OP
    when 'INSERT' then jsonb_build_object('after',  to_jsonb(new))
    when 'UPDATE' then jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new))
    when 'DELETE' then jsonb_build_object('before', to_jsonb(old))
  end;

  insert into public.audit_log (shop_id, actor_id, action, entity, entity_id, diff)
  values (v_shop_id, auth.uid(), lower(TG_OP), TG_TABLE_NAME, v_entity_id, v_diff);

  return coalesce(new, old);
end;
$$;

-- Attach to sensitive tables only (keep audit_log volume manageable).
create trigger audit_log_clients
  after insert or update or delete on public.clients
  for each row execute procedure public.tg_audit_log();

create trigger audit_log_appointments
  after insert or update or delete on public.appointments
  for each row execute procedure public.tg_audit_log();

create trigger audit_log_discounts
  after insert or update or delete on public.discounts
  for each row execute procedure public.tg_audit_log();

create trigger audit_log_promo_codes
  after insert or update or delete on public.promo_codes
  for each row execute procedure public.tg_audit_log();

create trigger audit_log_commission_tiers
  after insert or update or delete on public.commission_tiers
  for each row execute procedure public.tg_audit_log();

create trigger audit_log_payment_profiles
  after insert or update or delete on public.payment_profiles
  for each row execute procedure public.tg_audit_log();

create trigger audit_log_shop_members
  after insert or update or delete on public.shop_members
  for each row execute procedure public.tg_audit_log();

-- =============================================================================
-- profiles bootstrap — auto-create a profile row when auth.users gets an entry.
-- Mirrors Supabase's standard pattern for "create user" flows.
-- =============================================================================
create or replace function public.tg_create_profile_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', null)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.tg_create_profile_on_signup();
