-- ---------------------------------------------------------------------------
-- Settings · money data hygiene (Settings·Money audit — T6 / SM-16). Mirror of
-- the services W2 migration
-- (20260611130000_services_unique_name_and_category_order.sql) and products
-- (20260610150000_products_unique_name_and_status.sql).
--
-- UNIQUE (shop_id, name) on taxes AND discounts. product_brands and
-- product_categories ship `unique (shop_id, name)` since init
-- (20260523000001_init_schema.sql:243,252) and services aligned in
-- 20260611130000 — but taxes and discounts never did: two "TPS" taxes or two
-- "Black Friday" discounts in one shop are a data-entry footgun (ambiguous
-- picker, duplicate rows, no way to tell which one an edit/delete targets).
-- Align both money tables on the same per-shop-unique-name rule. The 23505
-- these indexes raise is mapped to err('CONFLICT', { name: 'duplicate' }) in
-- settings/taxes/actions.ts and settings/discounts/actions.ts (T6).
-- promo_codes already ships unique(shop_id, code) since init.
--
-- ⚠ PRE-DEPLOY (prod): the unique indexes FAIL to build if duplicates already
--    exist. Verify BOTH tables first:
--      select shop_id, name, count(*) from public.taxes
--      group by shop_id, name having count(*) > 1;
--      select shop_id, name, count(*) from public.discounts
--      group by shop_id, name having count(*) > 1;
--    Expected EMPTY — the seed has no per-shop name dupes. If any row returns,
--    rename/merge before applying.
--
-- Re-runnable: `if not exists` on both indexes.
-- ---------------------------------------------------------------------------

create unique index if not exists taxes_shop_name_unique
  on public.taxes (shop_id, name);

create unique index if not exists discounts_shop_name_unique
  on public.discounts (shop_id, name);
