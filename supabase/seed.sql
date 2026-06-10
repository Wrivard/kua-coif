-- =============================================================================
-- seed.sql — Axum barbershop seed exactly per CLAUDE.md annexe.
--
-- This file is idempotent on a fresh database. To re-run on a non-empty DB,
-- delete the shop first: `delete from public.shops where alias = 'axum';`
-- (the cascade will clear every dependent row).
-- =============================================================================

do $$
declare
  v_shop_id uuid;

  v_tax_tps_id uuid;
  v_tax_tvq_id uuid;

  v_cat_senior_id uuid;
  v_cat_junior_id uuid;
  v_cat_stylist_id uuid;

  v_brand_aura_id uuid;
  v_brand_olive_id uuid;
  v_brand_purepousse_id uuid;
  v_brand_stmnt_id uuid;

  v_prodcat_afro_id uuid;
  v_prodcat_cauc_id uuid;

  v_barber_arsh_id uuid;
  v_barber_elmer_id uuid;
  v_barber_witzson_id uuid;
  v_barber_olivier_id uuid;

  v_svc_senior_haircut_beard_id uuid;
  v_svc_senior_haircut_id uuid;
  v_svc_junior_haircut_beard_id uuid;
  v_svc_junior_beard_lineup_id uuid;
  v_svc_senior_beard_lineup_id uuid;

  -- Appointment clients
  v_c_jules uuid;
  v_c_drew uuid;
  v_c_tjo uuid;
  v_c_glenn uuid;
  v_c_mohamed uuid;
  v_c_lito uuid;
  v_c_nelson uuid;

  v_appt_date date := date '2026-05-22';
begin
  ---------------------------------------------------------------------------
  -- SHOP
  ---------------------------------------------------------------------------
  insert into public.shops (
    name, alias, website, phone, email, instagram,
    timezone, date_format, default_language,
    default_cash_drawer_balance,
    age_21_only, allow_booking_any_barber, gross_up_fees,
    use_prod_price_in_tips, use_taxes_in_tips, client_reviews,
    payout_discount_mode,
    country, street, municipality, province, postal_code,
    created_at
  ) values (
    'Axum barbershop', 'axum',
    'https://www.axumbarbershop.com',
    '+15144523057',
    'oliviertcheuffa.b+1@gmail.com',
    'axumsalon',
    'America/Toronto', 'USA', 'en',
    0,
    false, true, true, true, true, true,
    'split',
    'Canada', '3857 Boulevard Décarie', 'Montréal', 'QC', 'H4A 3J6',
    '2024-12-03T00:00:00-05:00'::timestamptz
  ) returning id into v_shop_id;

  ---------------------------------------------------------------------------
  -- SHOP HOURS — Sun/Mon off, Tue–Wed 10–19, Thu–Fri 10–20, Sat 10–17
  ---------------------------------------------------------------------------
  insert into public.shop_hours (shop_id, weekday, enabled, open_time, close_time) values
    (v_shop_id, 0, false, null, null),                      -- Sunday
    (v_shop_id, 1, false, null, null),                      -- Monday
    (v_shop_id, 2, true,  '10:00', '19:00'),                -- Tuesday
    (v_shop_id, 3, true,  '10:00', '19:00'),                -- Wednesday
    (v_shop_id, 4, true,  '10:00', '20:00'),                -- Thursday
    (v_shop_id, 5, true,  '10:00', '20:00'),                -- Friday
    (v_shop_id, 6, true,  '10:00', '17:00');                -- Saturday

  ---------------------------------------------------------------------------
  -- TAXES — TPS 5%, TVQ 9.975%
  ---------------------------------------------------------------------------
  insert into public.taxes (shop_id, name, percentage, add_to_price, external_orders_only, enabled)
    values (v_shop_id, 'TPS', 5.000, true, false, true)
    returning id into v_tax_tps_id;
  insert into public.taxes (shop_id, name, percentage, add_to_price, external_orders_only, enabled)
    values (v_shop_id, 'TVQ', 9.975, true, false, true)
    returning id into v_tax_tvq_id;

  ---------------------------------------------------------------------------
  -- SERVICE CATEGORIES (orthographe d'origine conservée)
  ---------------------------------------------------------------------------
  insert into public.service_categories (shop_id, name, sort_order)
    values (v_shop_id, 'senior stylist', 1) returning id into v_cat_senior_id;
  insert into public.service_categories (shop_id, name, sort_order)
    values (v_shop_id, 'junioir barber', 2) returning id into v_cat_junior_id;
  insert into public.service_categories (shop_id, name, sort_order)
    values (v_shop_id, 'stylist', 3) returning id into v_cat_stylist_id;

  ---------------------------------------------------------------------------
  -- SERVICES — 14 services, all enabled, all TPS+TVQ
  ---------------------------------------------------------------------------
  insert into public.services (shop_id, category_id, name, duration_min, price, sort_order) values
    (v_shop_id, v_cat_senior_id, 'Kid''s Haircut',           30, 30.44, 1),
    (v_shop_id, v_cat_senior_id, 'Beard Trim + Line Up',     30, 30.44, 2),
    (v_shop_id, v_cat_senior_id, 'Haircut',                  30, 34.79, 3),
    (v_shop_id, v_cat_senior_id, 'Haircut + Beard',          45, 43.49, 4),
    (v_shop_id, v_cat_senior_id, 'Scissors Haircut',         45, 39.14, 5),
    (v_shop_id, v_cat_senior_id, 'Scissors Haircut + Beard', 60, 47.84, 6),
    (v_shop_id, v_cat_junior_id, 'haircut',                  45, 30.44, 1),
    (v_shop_id, v_cat_junior_id, 'haircut + beard',          60, 39.14, 2),
    (v_shop_id, v_cat_junior_id, 'kid''s haircut',           35, 26.09, 3),
    (v_shop_id, v_cat_junior_id, 'beard trim + lineup',      30, 26.09, 4),
    (v_shop_id, v_cat_junior_id, 'full scissors',            60, 34.79, 5),
    (v_shop_id, v_cat_junior_id, 'full scissors haircut + Beard', 75, 43.49, 6),
    (v_shop_id, v_cat_stylist_id, 'haircut',                 35, 30.44, 1),
    (v_shop_id, v_cat_stylist_id, 'haircut + Beard',         45, 39.14, 2);

  -- Attach TPS + TVQ to every service.
  insert into public.service_taxes (service_id, tax_id)
    select id, v_tax_tps_id from public.services where shop_id = v_shop_id
    union all
    select id, v_tax_tvq_id from public.services where shop_id = v_shop_id;

  -- Cache some services we'll reference later for appointments.
  select id into v_svc_senior_haircut_beard_id
    from public.services where shop_id = v_shop_id and category_id = v_cat_senior_id and name = 'Haircut + Beard';
  select id into v_svc_senior_haircut_id
    from public.services where shop_id = v_shop_id and category_id = v_cat_senior_id and name = 'Haircut';
  select id into v_svc_junior_haircut_beard_id
    from public.services where shop_id = v_shop_id and category_id = v_cat_junior_id and name = 'haircut + beard';
  select id into v_svc_junior_beard_lineup_id
    from public.services where shop_id = v_shop_id and category_id = v_cat_junior_id and name = 'beard trim + lineup';
  select id into v_svc_senior_beard_lineup_id
    from public.services where shop_id = v_shop_id and category_id = v_cat_senior_id and name = 'Beard Trim + Line Up';

  ---------------------------------------------------------------------------
  -- PRODUCT BRANDS + CATEGORIES
  ---------------------------------------------------------------------------
  insert into public.product_brands (shop_id, name) values (v_shop_id, 'AURA')      returning id into v_brand_aura_id;
  insert into public.product_brands (shop_id, name) values (v_shop_id, 'OLIVE OIL') returning id into v_brand_olive_id;
  insert into public.product_brands (shop_id, name) values (v_shop_id, 'PUREPOUSSE')returning id into v_brand_purepousse_id;
  insert into public.product_brands (shop_id, name) values (v_shop_id, 'STMNT')     returning id into v_brand_stmnt_id;

  insert into public.product_categories (shop_id, name) values (v_shop_id, 'AFRO')      returning id into v_prodcat_afro_id;
  insert into public.product_categories (shop_id, name) values (v_shop_id, 'CAUCASIEN') returning id into v_prodcat_cauc_id;

  ---------------------------------------------------------------------------
  -- PRODUCTS — 14 lines from annexe Image 11
  ---------------------------------------------------------------------------
  with rows as (
    insert into public.products (shop_id, brand_id, category_id, name, price, supply_price, current_inventory, low_inventory_threshold)
    values
      (v_shop_id, null,                  v_prodcat_afro_id, 'AFRO Comb',              10.00,  0.00,  5, 3),
      (v_shop_id, v_brand_aura_id,       v_prodcat_cauc_id, 'AURA POWDER (big)',      28.70, 10.00, 10, 5),
      (v_shop_id, v_brand_aura_id,       v_prodcat_cauc_id, 'AURA POWDER (small)',    21.74, 10.00,  8, 5),
      (v_shop_id, null,                  v_prodcat_afro_id, 'Curl Sponge',            10.00,  5.00, 13, 5),
      (v_shop_id, v_brand_olive_id,      v_prodcat_afro_id, 'OLIVE OIL (mousse)',     13.05,  4.00, 17, 5),
      (v_shop_id, v_brand_purepousse_id, v_prodcat_afro_id, 'Purepousse BAUME',       36.56, 46.55,  5, 3),
      (v_shop_id, v_brand_purepousse_id, v_prodcat_afro_id, 'Purepousse ELIXIR',      46.55, 46.55,  1, 3),
      (v_shop_id, v_brand_purepousse_id, v_prodcat_afro_id, 'Purepousse LAIT',        36.55, 46.55,  8, 3),
      (v_shop_id, v_brand_purepousse_id, v_prodcat_afro_id, 'Purepousse MASQUE',      39.26, 46.55,  6, 3),
      (v_shop_id, v_brand_purepousse_id, v_prodcat_afro_id, 'Purepousse SHAMPOING',   32.50, 46.55,  7, 3),
      (v_shop_id, v_brand_purepousse_id, v_prodcat_afro_id, 'Purepousse SPRAY',       29.05, 46.55,  9, 3),
      (v_shop_id, v_brand_stmnt_id,      v_prodcat_cauc_id, 'Stint CLASSIC POMADE',   33.05, 19.25,  3, 5),
      (v_shop_id, v_brand_stmnt_id,      v_prodcat_cauc_id, 'Stmnt BEARD OIL',        28.70, 16.25,  1, 5),
      (v_shop_id, v_brand_stmnt_id,      v_prodcat_cauc_id, 'Stmnt CONDITIONER',      28.70, 16.25,  2, 0)
    returning id, name
  )
  insert into public.product_taxes (product_id, tax_id)
    select r.id, v_tax_tps_id
      from rows r
     where r.name in ('AURA POWDER (big)', 'AURA POWDER (small)', 'OLIVE OIL (mousse)',
                      'Stint CLASSIC POMADE', 'Stmnt BEARD OIL', 'Stmnt CONDITIONER')
    union all
    select r.id, v_tax_tvq_id
      from rows r
     where r.name in ('AURA POWDER (big)', 'AURA POWDER (small)', 'OLIVE OIL (mousse)',
                      'Stint CLASSIC POMADE', 'Stmnt BEARD OIL', 'Stmnt CONDITIONER');

  ---------------------------------------------------------------------------
  -- BARBERS (4 confirmed) — no auth user yet, user_id stays null
  ---------------------------------------------------------------------------
  insert into public.barbers (shop_id, display_name, email, phone, sort_order, status)
    values (v_shop_id, 'Arsh',             'arshdeepsingh03000@gmail.com', '+15146994290', 1, 'confirmed')
    returning id into v_barber_arsh_id;
  insert into public.barbers (shop_id, display_name, email, phone, sort_order, status)
    values (v_shop_id, 'Elmer Martinez',   'elmernetch@gmail.com',         '+14384586664', 2, 'confirmed')
    returning id into v_barber_elmer_id;
  insert into public.barbers (shop_id, display_name, email, phone, sort_order, status)
    values (v_shop_id, 'Witzson Beaubrun', 'witzson.beaubrun@gmail.com',   '+14388665206', 3, 'confirmed')
    returning id into v_barber_witzson_id;
  insert into public.barbers (shop_id, display_name, email, phone, sort_order, status)
    values (v_shop_id, 'Olivier',          'Oliviertcheuffa.b@gmail.com',  '+15144523057', 4, 'confirmed')
    returning id into v_barber_olivier_id;

  ---------------------------------------------------------------------------
  -- BARBER SETTINGS — 1 shop default + 1 per barber.
  -- confirmation_tip = true only on the shop row (per annexe Image 7).
  ---------------------------------------------------------------------------
  insert into public.barber_settings (shop_id, scope, barber_id, confirmation_tip)
    values (v_shop_id, 'shop',   null,                 true);
  insert into public.barber_settings (shop_id, scope, barber_id, confirmation_tip)
    values (v_shop_id, 'barber', v_barber_arsh_id,     false),
           (v_shop_id, 'barber', v_barber_elmer_id,    false),
           (v_shop_id, 'barber', v_barber_witzson_id,  false),
           (v_shop_id, 'barber', v_barber_olivier_id,  false);

  ---------------------------------------------------------------------------
  -- COMMISSION TIERS — services scope, cumulative false (annexe Image 5)
  ---------------------------------------------------------------------------
  insert into public.commission_tiers (
    shop_id, barber_id, scope, cumulative,
    tier1_threshold, tier1_pct, tier2_threshold, tier2_pct,
    tier3_threshold, tier3_pct, tier4_threshold, tier4_pct,
    tier5_threshold, tier5_pct
  ) values
    (v_shop_id, v_barber_olivier_id, 'services', false,
       0,    55,  1000, 60,  2000, 65,  2500, 70,  30000, 100),
    (v_shop_id, v_barber_witzson_id, 'services', false,
       0,    55,  1000, 60,  2000, 65,  2500, 70,   3000, 100),
    (v_shop_id, v_barber_elmer_id, 'services', false,
       0,    55,  1000, 60,  2000, 65,  2500, 70,   3000, 100),
    (v_shop_id, v_barber_arsh_id, 'services', false,
       0,     0,     0,  0,     0,  0,     0,  0,      0,   0);

  ---------------------------------------------------------------------------
  -- DISCOUNTS (annexe Image 6)
  ---------------------------------------------------------------------------
  insert into public.discounts (shop_id, name, type, value, assignment) values
    (v_shop_id, '1 referral',        'percent', 15,    'services_only'),
    (v_shop_id, '2 referral',        'percent', 35,    'services_only'),
    (v_shop_id, 'First appointment', 'percent', 20,    'services_only'),
    (v_shop_id, 'STUDENT DISCOUNT',  'fixed',    5.00, 'services_only'),
    (v_shop_id, 'custom amount',     'percent', 98,    'services_only');

  ---------------------------------------------------------------------------
  -- PROMO CODE (annexe Image 12)
  ---------------------------------------------------------------------------
  insert into public.promo_codes (
    shop_id, code, type, value, first_appointment_only, one_time,
    expiration_date, redemptions, total_redemption_value
  ) values (
    v_shop_id, 'WELCOME20', 'percent', 20,
    true, true, null, 1, 6.09
  );

  ---------------------------------------------------------------------------
  -- LOYALTY (annexe Image 9 — disabled by default, transaction based)
  ---------------------------------------------------------------------------
  insert into public.loyalty_program (
    shop_id, enabled, type, goal_count, min_transaction_amount, reward_amount,
    include_product_sales, include_tips
  ) values (
    v_shop_id, false, 'transaction', 4, 30, 0, false, false
  );

  ---------------------------------------------------------------------------
  -- TIPS CONFIG (annexe Image 15)
  ---------------------------------------------------------------------------
  insert into public.tips_config (
    shop_id, round_up,
    pct_tier1, pct_tier2, pct_tier3, pct_tier4, pct_use_above_amount,
    flat_tier1, flat_tier2, flat_tier3, flat_tier4,
    booking_tip, confirmation_tip
  ) values (
    v_shop_id, true,
    15, 18, 20, 25, 10.00,
    2.00, 3.00, 4.00, 5.00,
    true, true
  );

  ---------------------------------------------------------------------------
  -- PAYMENT PROFILE
  ---------------------------------------------------------------------------
  -- Loop 59 hotfix — we no longer seed a fake business profile. The
  -- Axum row showed up at /settings/payments out of the box (legal
  -- name "Salon Axum inc.", RBC •••• 7277, Yossa-olivier as profile
  -- owner, etc.) which is confusing for a real operator opening the
  -- page for the first time. The /settings/payments edit flow now
  -- starts from a blank slate; the upsert action creates the row on
  -- first save.
  --
  -- If you need the seeded fixture data back for screenshots or
  -- demo, restore the insert from git history (commit 6e99003^).

  ---------------------------------------------------------------------------
  -- WAITING LIST CONFIG (annexe Image 17)
  ---------------------------------------------------------------------------
  insert into public.waiting_list_config (shop_id, enabled, threshold_hours)
    values (v_shop_id, true, 3);

  ---------------------------------------------------------------------------
  -- CLIENTS (~30 + deliberate duplicate phone for "Locate Duplicates" demo)
  ---------------------------------------------------------------------------
  insert into public.clients (shop_id, first_name, last_name, email, phone) values
    (v_shop_id, 'Aaron',    'O',         'aaron.o@example.com',           '+18733761256'),
    (v_shop_id, 'Aaron',    'O',         'aaron.other@example.com',       '+18733761256'),  -- duplicate phone
    (v_shop_id, 'abdella',  null,         null,                            '+15145550101'),
    (v_shop_id, 'Adèle',    'Tremblay',  'adele.tremblay@example.com',    '+15145550102'),
    (v_shop_id, 'Ahmed',    'Ben Ali',   'ahmed.benali@example.com',      '+15145550103'),
    (v_shop_id, 'Camille',  'Bouchard',  'camille.bouchard@example.com',  '+15145550104'),
    (v_shop_id, 'Charles',  'Lefebvre',  'c.lefebvre@example.com',        '+15145550105'),
    (v_shop_id, 'Dimitri',  'Papadopoulos','dimitri.p@example.com',       '+15145550106'),
    (v_shop_id, 'Drew',     'Paris',     'drew.paris@example.com',        '+15145550107'),
    (v_shop_id, 'Élodie',   'Gagnon',    null,                            '+15145550108'),
    (v_shop_id, 'Fatou',    'Diallo',    'fatou.diallo@example.com',      '+15145550109'),
    (v_shop_id, 'Glenn',    'Nz',        'glenn.nz@example.com',          '+15145550110'),
    (v_shop_id, 'Hugo',     'Roy',       'hugo.roy@example.com',          '+15145550111'),
    (v_shop_id, 'Ibrahim',  'Khan',      'ibrahim.khan@example.com',      '+15145550112'),
    (v_shop_id, 'Isabelle', 'Côté',      'isabelle.cote@example.com',     '+15145550113'),
    (v_shop_id, 'Jules',    'Lethor',    'jules.lethor@example.com',      '+15145550114'),
    (v_shop_id, 'Kenji',    'Tanaka',    'kenji.tanaka@example.com',      '+15145550115'),
    (v_shop_id, 'Lito',     'Gordon',    'lito.gordon@example.com',       '+15145550116'),
    (v_shop_id, 'Maxime',   'Boucher',   null,                            '+15145550117'),
    (v_shop_id, 'Mohamed',  'Toure',     'mohamed.toure@example.com',     '+15145550118'),
    (v_shop_id, 'Nadia',    'Haddad',    'nadia.haddad@example.com',      '+15145550119'),
    (v_shop_id, 'Nelson',   'Kabuya',    'nelson.kabuya@example.com',     '+15145550120'),
    (v_shop_id, 'Olivia',   'Bélanger',  'olivia.belanger@example.com',   '+15145550121'),
    (v_shop_id, 'Pablo',    'Martinez',  'pablo.martinez@example.com',    '+15145550122'),
    (v_shop_id, 'Quentin',  'Lavoie',    'quentin.lavoie@example.com',    '+15145550123'),
    (v_shop_id, 'Raphaël',  'Levesque',  null,                            '+15145550124'),
    (v_shop_id, 'Sophie',   'Beaulieu',  'sophie.beaulieu@example.com',   '+15145550125'),
    (v_shop_id, 'tjo',      'tjo',       null,                            '+15145550126'),
    (v_shop_id, 'Tariq',    'Achour',    'tariq.achour@example.com',      '+15145550127'),
    (v_shop_id, 'Ulysse',   'Demers',    'ulysse.demers@example.com',     '+15145550128'),
    (v_shop_id, 'Viktor',   'Petrov',    'viktor.petrov@example.com',     '+15145550129'),
    (v_shop_id, 'Yannick',  'Dubois',    'yannick.dubois@example.com',    '+15145550130');

  -- Cache the client IDs we need for the May 22 2026 appointments.
  select id into v_c_jules   from public.clients where shop_id = v_shop_id and first_name = 'Jules'   and last_name = 'Lethor';
  select id into v_c_drew    from public.clients where shop_id = v_shop_id and first_name = 'Drew'    and last_name = 'Paris';
  select id into v_c_tjo     from public.clients where shop_id = v_shop_id and first_name = 'tjo'     and last_name = 'tjo';
  select id into v_c_glenn   from public.clients where shop_id = v_shop_id and first_name = 'Glenn'   and last_name = 'Nz';
  select id into v_c_mohamed from public.clients where shop_id = v_shop_id and first_name = 'Mohamed' and last_name = 'Toure';
  select id into v_c_lito    from public.clients where shop_id = v_shop_id and first_name = 'Lito'    and last_name = 'Gordon';
  select id into v_c_nelson  from public.clients where shop_id = v_shop_id and first_name = 'Nelson'  and last_name = 'Kabuya';

  ---------------------------------------------------------------------------
  -- APPOINTMENTS — Fri May 22 2026 (America/Toronto). Stored as UTC.
  -- Eastern Daylight Time on that date is UTC-4, so e.g. 08:15 EDT = 12:15 UTC.
  ---------------------------------------------------------------------------
  -- Olivier
  with a as (
    insert into public.appointments (
      shop_id, barber_id, client_id, start_at, end_at, status, source, total_amount
    ) values (
      v_shop_id, v_barber_olivier_id, v_c_jules,
      (v_appt_date + time '08:15') at time zone 'America/Toronto',
      (v_appt_date + time '08:45') at time zone 'America/Toronto',
      'confirmed', 'admin', 43.49
    ) returning id
  )
  insert into public.appointment_services (appointment_id, service_id, price_snapshot)
    select a.id, v_svc_senior_haircut_beard_id, 43.49 from a;

  with a as (
    insert into public.appointments (
      shop_id, barber_id, client_id, start_at, end_at, status, source, total_amount
    ) values (
      v_shop_id, v_barber_olivier_id, v_c_drew,
      (v_appt_date + time '09:10') at time zone 'America/Toronto',
      (v_appt_date + time '09:55') at time zone 'America/Toronto',
      'confirmed', 'admin', 43.49
    ) returning id
  )
  insert into public.appointment_services (appointment_id, service_id, price_snapshot)
    select a.id, v_svc_senior_haircut_beard_id, 43.49 from a;

  with a as (
    insert into public.appointments (
      shop_id, barber_id, client_id, start_at, end_at, status, source, total_amount
    ) values (
      v_shop_id, v_barber_olivier_id, v_c_tjo,
      (v_appt_date + time '10:30') at time zone 'America/Toronto',
      (v_appt_date + time '11:00') at time zone 'America/Toronto',
      'confirmed', 'admin', 34.79
    ) returning id
  )
  insert into public.appointment_services (appointment_id, service_id, price_snapshot)
    select a.id, v_svc_senior_haircut_id, 34.79 from a;

  with a as (
    insert into public.appointments (
      shop_id, barber_id, client_id, start_at, end_at, status, source, total_amount
    ) values (
      v_shop_id, v_barber_olivier_id, v_c_glenn,
      (v_appt_date + time '11:00') at time zone 'America/Toronto',
      (v_appt_date + time '11:45') at time zone 'America/Toronto',
      'confirmed', 'admin', 43.49
    ) returning id
  )
  insert into public.appointment_services (appointment_id, service_id, price_snapshot)
    select a.id, v_svc_senior_haircut_beard_id, 43.49 from a;

  -- Witzson
  with a as (
    insert into public.appointments (
      shop_id, barber_id, client_id, start_at, end_at, status, source, total_amount
    ) values (
      v_shop_id, v_barber_witzson_id, v_c_mohamed,
      (v_appt_date + time '10:00') at time zone 'America/Toronto',
      (v_appt_date + time '10:45') at time zone 'America/Toronto',
      'confirmed', 'admin', 39.14
    ) returning id
  )
  insert into public.appointment_services (appointment_id, service_id, price_snapshot)
    select a.id, v_svc_junior_haircut_beard_id, 39.14 from a;

  with a as (
    insert into public.appointments (
      shop_id, barber_id, client_id, start_at, end_at, status, source, total_amount
    ) values (
      v_shop_id, v_barber_witzson_id, v_c_lito,
      (v_appt_date + time '11:00') at time zone 'America/Toronto',
      (v_appt_date + time '11:35') at time zone 'America/Toronto',
      'confirmed', 'admin', 30.44
    ) returning id
  )
  insert into public.appointment_services (appointment_id, service_id, price_snapshot)
    select a.id, v_svc_senior_haircut_id, 30.44 from a;

  -- Elmer
  with a as (
    insert into public.appointments (
      shop_id, barber_id, client_id, start_at, end_at, status, source, total_amount
    ) values (
      v_shop_id, v_barber_elmer_id, v_c_nelson,
      (v_appt_date + time '10:30') at time zone 'America/Toronto',
      (v_appt_date + time '11:00') at time zone 'America/Toronto',
      'confirmed', 'admin', 26.09
    ) returning id
  )
  insert into public.appointment_services (appointment_id, service_id, price_snapshot)
    select a.id, v_svc_junior_beard_lineup_id, 26.09 from a;

  -- Arsh: no appointments on May 22 2026.

  raise notice 'Seed completed for shop %', v_shop_id;
end$$;
