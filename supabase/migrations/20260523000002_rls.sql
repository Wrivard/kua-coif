-- =============================================================================
-- 20260523000002_rls.sql
-- Row-level security: each tenant (shop) is fully isolated.
-- The default deny stance is enabled by `alter table … force row level security`
-- — even the table owner needs explicit policies to read/write.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Profiles — a user can read/update only their own profile.
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

create policy "profiles_select_self"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles_update_self"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles_insert_self"
  on public.profiles for insert
  with check (id = auth.uid());

-- -----------------------------------------------------------------------------
-- Helper macro — every shop-scoped table follows the same pattern. We can't
-- create true SQL macros, so each table gets four explicit policies. The
-- predicate is consistent: shop_id ∈ current_shop_ids().
-- -----------------------------------------------------------------------------

-- shops itself: members of the shop can SELECT/UPDATE, only owners can DELETE,
-- INSERT is reserved to authenticated users with the dedicated onboarding RPC
-- (kept open here so a fresh signup can create their first shop).
alter table public.shops enable row level security;
alter table public.shops force row level security;

create policy "shops_select" on public.shops
  for select using (public.is_shop_member(id));
create policy "shops_insert" on public.shops
  for insert with check (auth.uid() is not null);
create policy "shops_update" on public.shops
  for update using (public.has_role_in_shop(id, 'manager'))
  with check (public.has_role_in_shop(id, 'manager'));
create policy "shops_delete" on public.shops
  for delete using (public.has_role_in_shop(id, 'owner'));

-- -----------------------------------------------------------------------------
-- shop_hours
-- -----------------------------------------------------------------------------
alter table public.shop_hours enable row level security;
alter table public.shop_hours force row level security;
create policy "shop_hours_rw" on public.shop_hours
  for all using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

-- -----------------------------------------------------------------------------
-- shop_days_off
-- -----------------------------------------------------------------------------
alter table public.shop_days_off enable row level security;
alter table public.shop_days_off force row level security;
create policy "shop_days_off_rw" on public.shop_days_off
  for all using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

-- -----------------------------------------------------------------------------
-- shop_members — visible to anyone in the same shop, mutated only by managers.
-- -----------------------------------------------------------------------------
alter table public.shop_members enable row level security;
alter table public.shop_members force row level security;

create policy "shop_members_select" on public.shop_members
  for select using (public.is_shop_member(shop_id));
create policy "shop_members_insert" on public.shop_members
  for insert with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "shop_members_update" on public.shop_members
  for update using (public.has_role_in_shop(shop_id, 'manager'))
  with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "shop_members_delete" on public.shop_members
  for delete using (public.has_role_in_shop(shop_id, 'manager'));

-- -----------------------------------------------------------------------------
-- barbers
-- -----------------------------------------------------------------------------
alter table public.barbers enable row level security;
alter table public.barbers force row level security;
create policy "barbers_rw" on public.barbers
  for all using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

-- -----------------------------------------------------------------------------
-- barber_settings
-- -----------------------------------------------------------------------------
alter table public.barber_settings enable row level security;
alter table public.barber_settings force row level security;
create policy "barber_settings_rw" on public.barber_settings
  for all using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

-- -----------------------------------------------------------------------------
-- taxes
-- -----------------------------------------------------------------------------
alter table public.taxes enable row level security;
alter table public.taxes force row level security;
create policy "taxes_rw" on public.taxes
  for all using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

-- -----------------------------------------------------------------------------
-- service_categories
-- -----------------------------------------------------------------------------
alter table public.service_categories enable row level security;
alter table public.service_categories force row level security;
create policy "service_categories_rw" on public.service_categories
  for all using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

-- -----------------------------------------------------------------------------
-- services
-- -----------------------------------------------------------------------------
alter table public.services enable row level security;
alter table public.services force row level security;
create policy "services_rw" on public.services
  for all using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

-- service_taxes uses the service's shop. We enforce via a subquery.
alter table public.service_taxes enable row level security;
alter table public.service_taxes force row level security;
create policy "service_taxes_rw" on public.service_taxes
  for all using (
    exists (
      select 1 from public.services s
      where s.id = service_taxes.service_id
        and public.is_shop_member(s.shop_id)
    )
  )
  with check (
    exists (
      select 1 from public.services s
      where s.id = service_taxes.service_id
        and public.is_shop_member(s.shop_id)
    )
  );

-- -----------------------------------------------------------------------------
-- product_brands / product_categories / products / product_taxes
-- -----------------------------------------------------------------------------
alter table public.product_brands enable row level security;
alter table public.product_brands force row level security;
create policy "product_brands_rw" on public.product_brands
  for all using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

alter table public.product_categories enable row level security;
alter table public.product_categories force row level security;
create policy "product_categories_rw" on public.product_categories
  for all using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

alter table public.products enable row level security;
alter table public.products force row level security;
create policy "products_rw" on public.products
  for all using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

alter table public.product_taxes enable row level security;
alter table public.product_taxes force row level security;
create policy "product_taxes_rw" on public.product_taxes
  for all using (
    exists (
      select 1 from public.products p
      where p.id = product_taxes.product_id
        and public.is_shop_member(p.shop_id)
    )
  )
  with check (
    exists (
      select 1 from public.products p
      where p.id = product_taxes.product_id
        and public.is_shop_member(p.shop_id)
    )
  );

-- -----------------------------------------------------------------------------
-- clients
-- -----------------------------------------------------------------------------
alter table public.clients enable row level security;
alter table public.clients force row level security;
create policy "clients_rw" on public.clients
  for all using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

-- -----------------------------------------------------------------------------
-- appointments + linkage
-- -----------------------------------------------------------------------------
alter table public.appointments enable row level security;
alter table public.appointments force row level security;
create policy "appointments_rw" on public.appointments
  for all using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

alter table public.appointment_services enable row level security;
alter table public.appointment_services force row level security;
create policy "appointment_services_rw" on public.appointment_services
  for all using (
    exists (
      select 1 from public.appointments a
      where a.id = appointment_services.appointment_id
        and public.is_shop_member(a.shop_id)
    )
  )
  with check (
    exists (
      select 1 from public.appointments a
      where a.id = appointment_services.appointment_id
        and public.is_shop_member(a.shop_id)
    )
  );

alter table public.blocked_time enable row level security;
alter table public.blocked_time force row level security;
create policy "blocked_time_rw" on public.blocked_time
  for all using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

-- -----------------------------------------------------------------------------
-- discounts / promo_codes / loyalty_program / commission_tiers / tips_config
-- payment_profiles / notification_prefs / waiting_list_config
-- -----------------------------------------------------------------------------
alter table public.discounts enable row level security;
alter table public.discounts force row level security;
create policy "discounts_rw" on public.discounts
  for all using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

alter table public.promo_codes enable row level security;
alter table public.promo_codes force row level security;
create policy "promo_codes_rw" on public.promo_codes
  for all using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

alter table public.loyalty_program enable row level security;
alter table public.loyalty_program force row level security;
create policy "loyalty_program_rw" on public.loyalty_program
  for all using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

alter table public.commission_tiers enable row level security;
alter table public.commission_tiers force row level security;
create policy "commission_tiers_rw" on public.commission_tiers
  for all using (public.has_role_in_shop(shop_id, 'manager'))
  with check (public.has_role_in_shop(shop_id, 'manager'));
-- Barbers can see their own tiers via SELECT-only policy:
create policy "commission_tiers_select_self" on public.commission_tiers
  for select using (
    exists (
      select 1 from public.barbers b
      where b.id = commission_tiers.barber_id
        and b.user_id = auth.uid()
    )
  );

alter table public.tips_config enable row level security;
alter table public.tips_config force row level security;
create policy "tips_config_rw" on public.tips_config
  for all using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

alter table public.payment_profiles enable row level security;
alter table public.payment_profiles force row level security;
-- Sensitive — owners only.
create policy "payment_profiles_rw" on public.payment_profiles
  for all using (public.has_role_in_shop(shop_id, 'owner'))
  with check (public.has_role_in_shop(shop_id, 'owner'));

alter table public.notification_prefs enable row level security;
alter table public.notification_prefs force row level security;
create policy "notification_prefs_rw" on public.notification_prefs
  for all using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

alter table public.waiting_list_config enable row level security;
alter table public.waiting_list_config force row level security;
create policy "waiting_list_config_rw" on public.waiting_list_config
  for all using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

-- -----------------------------------------------------------------------------
-- audit_log — write-only from the server, readable by managers of the shop.
-- -----------------------------------------------------------------------------
alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;
create policy "audit_log_select_managers" on public.audit_log
  for select using (
    shop_id is null or public.has_role_in_shop(shop_id, 'manager')
  );
-- No INSERT/UPDATE/DELETE policies — only the service role (server-side) writes.
