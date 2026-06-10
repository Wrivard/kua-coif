-- ---------------------------------------------------------------------------
-- Products catalog data hygiene (Produits audit — W2).
--
-- 1) UNIQUE (shop_id, name) on products. product_brands and product_categories
--    both ship `unique (shop_id, name)` (20260523000001_init_schema.sql:243,252)
--    but products did NOT — two products with the same name in one shop is a
--    data-entry footgun (ambiguous catalog, CSV export, future POS picker).
--    Align products on the same per-shop-unique-name rule.
--
-- 2) `status` column — EXACT mirror of services.status: the same
--    `service_status` enum ('enabled','disabled'), the same NOT NULL, the same
--    default 'enabled' (init_schema.sql:22,221). Reusing the existing enum makes
--    the value set + check identical to services by construction. Status is the
--    soft alternative to deleteProduct's hard delete (a disabled product drops
--    out of the active catalog / booking pickers without destroying history).
--    No partial index: services has none either — only a composite
--    (shop_id, status, sort_order) (20260523000003_indexes_triggers.sql:25),
--    and products has no sort_order column to mirror it. The set_updated_at
--    trigger already covers products (it attaches to every table with an
--    updated_at column), so the W2 optimistic-concurrency precondition works.
--
-- ⚠ PRE-DEPLOY (prod): the unique index FAILS to build if duplicates already
--    exist. Verify first:
--      select shop_id, name, count(*) from public.products
--      group by shop_id, name having count(*) > 1;
--    Expected EMPTY — the seed (supabase/seed.sql) has no per-shop name dupes.
--    If any row returns, rename/merge before applying.
--
-- Re-runnable: `if not exists` on the index, `add column if not exists` on the
-- column (the service_status enum already exists from init_schema).
-- ---------------------------------------------------------------------------

-- 1) Per-shop unique product name (mirrors product_brands / product_categories).
create unique index if not exists products_shop_name_unique
  on public.products (shop_id, name);

-- 2) Soft-status column, mirroring services.status exactly.
alter table public.products
  add column if not exists status public.service_status not null default 'enabled';
