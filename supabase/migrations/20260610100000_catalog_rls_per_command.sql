-- ---------------------------------------------------------------------------
-- Catalog/config RLS hardening — per-command policies (plan 003).
--
-- ⚠️ Access-boundary change. Mirrors the calendar per-command hardening
-- (20260607130000) and the barbers hardening (20260609180000). The Server
-- Action layer ALREADY gates every write on these tables behind
-- minRole='manager' (minRole='owner' for commission_tiers), so this is
-- defense-in-depth: it closes the direct-PostgREST bypass where a
-- barber-role session JWT could skip the UI entirely and call
-- `/rest/v1/promo_codes`, `/rest/v1/services`, … to insert a 100%-off promo
-- code, zero out service prices, delete products, or rewrite the
-- loyalty/tips/waiting-list config (the launch-era flat `_rw` policies were
-- `FOR ALL using is_shop_member(shop_id)` — shop-WIDE, so the manager-only
-- restriction lived only in app code).
--
-- Model: SELECT = any shop member (admin pages render the catalog for
-- barbers); INSERT/UPDATE/DELETE = manager+ only. has_role_in_shop(shop_id,
-- 'manager') returns true for owner+manager (rank-based). Exception:
-- commission_tiers writes are owner-only, matching saveCommissions'
-- minRole='owner' (previously a manager could write their own tiers via
-- PostgREST despite the owner-only action), and its SELECT is manager+
-- (managers see the commissions page; barbers keep reading their own rows
-- via the untouched commission_tiers_select_self policy from
-- 20260524144355_advisors_hotfix).
--
-- Unaffected legitimate flows (all service-role, RLS-bypassing): the public
-- booking/embed pages and actions (incl. the promo_codes redemption bump),
-- the super-admin shop provisioning catalog seed, the loyalty engine, crons.
--
-- Re-runnable (drop if exists).
-- ---------------------------------------------------------------------------

-- services --------------------------------------------------------------------
drop policy if exists "services_rw" on public.services;
drop policy if exists "services_select" on public.services;
drop policy if exists "services_insert" on public.services;
drop policy if exists "services_update" on public.services;
drop policy if exists "services_delete" on public.services;

create policy "services_select" on public.services
  for select using (public.is_shop_member(shop_id));
create policy "services_insert" on public.services
  for insert with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "services_update" on public.services
  for update
  using (public.has_role_in_shop(shop_id, 'manager'))
  with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "services_delete" on public.services
  for delete using (public.has_role_in_shop(shop_id, 'manager'));

-- service_categories ----------------------------------------------------------
drop policy if exists "service_categories_rw" on public.service_categories;
drop policy if exists "service_categories_select" on public.service_categories;
drop policy if exists "service_categories_insert" on public.service_categories;
drop policy if exists "service_categories_update" on public.service_categories;
drop policy if exists "service_categories_delete" on public.service_categories;

create policy "service_categories_select" on public.service_categories
  for select using (public.is_shop_member(shop_id));
create policy "service_categories_insert" on public.service_categories
  for insert with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "service_categories_update" on public.service_categories
  for update
  using (public.has_role_in_shop(shop_id, 'manager'))
  with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "service_categories_delete" on public.service_categories
  for delete using (public.has_role_in_shop(shop_id, 'manager'));

-- service_taxes (M:N — no shop_id; scoped via the parent service) -------------
drop policy if exists "service_taxes_rw" on public.service_taxes;
drop policy if exists "service_taxes_select" on public.service_taxes;
drop policy if exists "service_taxes_insert" on public.service_taxes;
drop policy if exists "service_taxes_update" on public.service_taxes;
drop policy if exists "service_taxes_delete" on public.service_taxes;

create policy "service_taxes_select" on public.service_taxes
  for select using (
    exists (
      select 1 from public.services s
      where s.id = service_taxes.service_id
        and public.is_shop_member(s.shop_id)
    )
  );
create policy "service_taxes_insert" on public.service_taxes
  for insert with check (
    exists (
      select 1 from public.services s
      where s.id = service_taxes.service_id
        and public.has_role_in_shop(s.shop_id, 'manager')
    )
  );
create policy "service_taxes_update" on public.service_taxes
  for update
  using (
    exists (
      select 1 from public.services s
      where s.id = service_taxes.service_id
        and public.has_role_in_shop(s.shop_id, 'manager')
    )
  )
  with check (
    exists (
      select 1 from public.services s
      where s.id = service_taxes.service_id
        and public.has_role_in_shop(s.shop_id, 'manager')
    )
  );
create policy "service_taxes_delete" on public.service_taxes
  for delete using (
    exists (
      select 1 from public.services s
      where s.id = service_taxes.service_id
        and public.has_role_in_shop(s.shop_id, 'manager')
    )
  );

-- products --------------------------------------------------------------------
drop policy if exists "products_rw" on public.products;
drop policy if exists "products_select" on public.products;
drop policy if exists "products_insert" on public.products;
drop policy if exists "products_update" on public.products;
drop policy if exists "products_delete" on public.products;

create policy "products_select" on public.products
  for select using (public.is_shop_member(shop_id));
create policy "products_insert" on public.products
  for insert with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "products_update" on public.products
  for update
  using (public.has_role_in_shop(shop_id, 'manager'))
  with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "products_delete" on public.products
  for delete using (public.has_role_in_shop(shop_id, 'manager'));

-- product_brands ---------------------------------------------------------------
drop policy if exists "product_brands_rw" on public.product_brands;
drop policy if exists "product_brands_select" on public.product_brands;
drop policy if exists "product_brands_insert" on public.product_brands;
drop policy if exists "product_brands_update" on public.product_brands;
drop policy if exists "product_brands_delete" on public.product_brands;

create policy "product_brands_select" on public.product_brands
  for select using (public.is_shop_member(shop_id));
create policy "product_brands_insert" on public.product_brands
  for insert with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "product_brands_update" on public.product_brands
  for update
  using (public.has_role_in_shop(shop_id, 'manager'))
  with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "product_brands_delete" on public.product_brands
  for delete using (public.has_role_in_shop(shop_id, 'manager'));

-- product_categories ------------------------------------------------------------
drop policy if exists "product_categories_rw" on public.product_categories;
drop policy if exists "product_categories_select" on public.product_categories;
drop policy if exists "product_categories_insert" on public.product_categories;
drop policy if exists "product_categories_update" on public.product_categories;
drop policy if exists "product_categories_delete" on public.product_categories;

create policy "product_categories_select" on public.product_categories
  for select using (public.is_shop_member(shop_id));
create policy "product_categories_insert" on public.product_categories
  for insert with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "product_categories_update" on public.product_categories
  for update
  using (public.has_role_in_shop(shop_id, 'manager'))
  with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "product_categories_delete" on public.product_categories
  for delete using (public.has_role_in_shop(shop_id, 'manager'));

-- product_taxes (M:N — no shop_id; scoped via the parent product) --------------
drop policy if exists "product_taxes_rw" on public.product_taxes;
drop policy if exists "product_taxes_select" on public.product_taxes;
drop policy if exists "product_taxes_insert" on public.product_taxes;
drop policy if exists "product_taxes_update" on public.product_taxes;
drop policy if exists "product_taxes_delete" on public.product_taxes;

create policy "product_taxes_select" on public.product_taxes
  for select using (
    exists (
      select 1 from public.products p
      where p.id = product_taxes.product_id
        and public.is_shop_member(p.shop_id)
    )
  );
create policy "product_taxes_insert" on public.product_taxes
  for insert with check (
    exists (
      select 1 from public.products p
      where p.id = product_taxes.product_id
        and public.has_role_in_shop(p.shop_id, 'manager')
    )
  );
create policy "product_taxes_update" on public.product_taxes
  for update
  using (
    exists (
      select 1 from public.products p
      where p.id = product_taxes.product_id
        and public.has_role_in_shop(p.shop_id, 'manager')
    )
  )
  with check (
    exists (
      select 1 from public.products p
      where p.id = product_taxes.product_id
        and public.has_role_in_shop(p.shop_id, 'manager')
    )
  );
create policy "product_taxes_delete" on public.product_taxes
  for delete using (
    exists (
      select 1 from public.products p
      where p.id = product_taxes.product_id
        and public.has_role_in_shop(p.shop_id, 'manager')
    )
  );

-- taxes -------------------------------------------------------------------------
drop policy if exists "taxes_rw" on public.taxes;
drop policy if exists "taxes_select" on public.taxes;
drop policy if exists "taxes_insert" on public.taxes;
drop policy if exists "taxes_update" on public.taxes;
drop policy if exists "taxes_delete" on public.taxes;

create policy "taxes_select" on public.taxes
  for select using (public.is_shop_member(shop_id));
create policy "taxes_insert" on public.taxes
  for insert with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "taxes_update" on public.taxes
  for update
  using (public.has_role_in_shop(shop_id, 'manager'))
  with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "taxes_delete" on public.taxes
  for delete using (public.has_role_in_shop(shop_id, 'manager'));

-- discounts ----------------------------------------------------------------------
drop policy if exists "discounts_rw" on public.discounts;
drop policy if exists "discounts_select" on public.discounts;
drop policy if exists "discounts_insert" on public.discounts;
drop policy if exists "discounts_update" on public.discounts;
drop policy if exists "discounts_delete" on public.discounts;

create policy "discounts_select" on public.discounts
  for select using (public.is_shop_member(shop_id));
create policy "discounts_insert" on public.discounts
  for insert with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "discounts_update" on public.discounts
  for update
  using (public.has_role_in_shop(shop_id, 'manager'))
  with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "discounts_delete" on public.discounts
  for delete using (public.has_role_in_shop(shop_id, 'manager'));

-- promo_codes ---------------------------------------------------------------------
drop policy if exists "promo_codes_rw" on public.promo_codes;
drop policy if exists "promo_codes_select" on public.promo_codes;
drop policy if exists "promo_codes_insert" on public.promo_codes;
drop policy if exists "promo_codes_update" on public.promo_codes;
drop policy if exists "promo_codes_delete" on public.promo_codes;

create policy "promo_codes_select" on public.promo_codes
  for select using (public.is_shop_member(shop_id));
create policy "promo_codes_insert" on public.promo_codes
  for insert with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "promo_codes_update" on public.promo_codes
  for update
  using (public.has_role_in_shop(shop_id, 'manager'))
  with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "promo_codes_delete" on public.promo_codes
  for delete using (public.has_role_in_shop(shop_id, 'manager'));

-- loyalty_program -------------------------------------------------------------------
drop policy if exists "loyalty_program_rw" on public.loyalty_program;
drop policy if exists "loyalty_program_select" on public.loyalty_program;
drop policy if exists "loyalty_program_insert" on public.loyalty_program;
drop policy if exists "loyalty_program_update" on public.loyalty_program;
drop policy if exists "loyalty_program_delete" on public.loyalty_program;

create policy "loyalty_program_select" on public.loyalty_program
  for select using (public.is_shop_member(shop_id));
create policy "loyalty_program_insert" on public.loyalty_program
  for insert with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "loyalty_program_update" on public.loyalty_program
  for update
  using (public.has_role_in_shop(shop_id, 'manager'))
  with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "loyalty_program_delete" on public.loyalty_program
  for delete using (public.has_role_in_shop(shop_id, 'manager'));

-- tips_config -------------------------------------------------------------------------
drop policy if exists "tips_config_rw" on public.tips_config;
drop policy if exists "tips_config_select" on public.tips_config;
drop policy if exists "tips_config_insert" on public.tips_config;
drop policy if exists "tips_config_update" on public.tips_config;
drop policy if exists "tips_config_delete" on public.tips_config;

create policy "tips_config_select" on public.tips_config
  for select using (public.is_shop_member(shop_id));
create policy "tips_config_insert" on public.tips_config
  for insert with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "tips_config_update" on public.tips_config
  for update
  using (public.has_role_in_shop(shop_id, 'manager'))
  with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "tips_config_delete" on public.tips_config
  for delete using (public.has_role_in_shop(shop_id, 'manager'));

-- waiting_list_config --------------------------------------------------------------------
drop policy if exists "waiting_list_config_rw" on public.waiting_list_config;
drop policy if exists "waiting_list_config_select" on public.waiting_list_config;
drop policy if exists "waiting_list_config_insert" on public.waiting_list_config;
drop policy if exists "waiting_list_config_update" on public.waiting_list_config;
drop policy if exists "waiting_list_config_delete" on public.waiting_list_config;

create policy "waiting_list_config_select" on public.waiting_list_config
  for select using (public.is_shop_member(shop_id));
create policy "waiting_list_config_insert" on public.waiting_list_config
  for insert with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "waiting_list_config_update" on public.waiting_list_config
  for update
  using (public.has_role_in_shop(shop_id, 'manager'))
  with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "waiting_list_config_delete" on public.waiting_list_config
  for delete using (public.has_role_in_shop(shop_id, 'manager'));

-- commission_tiers (special case: owner-only writes) --------------------------------------
-- saveCommissions is minRole='owner' — the old manager-level `_rw` policy let a
-- manager write tiers via PostgREST despite the owner-only action. SELECT stays
-- manager+ (the commissions page). Barbers keep reading their OWN tiers through
-- "commission_tiers_select_self" (redefined in 20260524144355_advisors_hotfix
-- with the initplan-cached auth.uid()) — deliberately NOT dropped here.
drop policy if exists "commission_tiers_rw" on public.commission_tiers;
drop policy if exists "commission_tiers_select" on public.commission_tiers;
drop policy if exists "commission_tiers_insert" on public.commission_tiers;
drop policy if exists "commission_tiers_update" on public.commission_tiers;
drop policy if exists "commission_tiers_delete" on public.commission_tiers;

create policy "commission_tiers_select" on public.commission_tiers
  for select using (public.has_role_in_shop(shop_id, 'manager'));
create policy "commission_tiers_insert" on public.commission_tiers
  for insert with check (public.has_role_in_shop(shop_id, 'owner'));
create policy "commission_tiers_update" on public.commission_tiers
  for update
  using (public.has_role_in_shop(shop_id, 'owner'))
  with check (public.has_role_in_shop(shop_id, 'owner'));
create policy "commission_tiers_delete" on public.commission_tiers
  for delete using (public.has_role_in_shop(shop_id, 'owner'));
