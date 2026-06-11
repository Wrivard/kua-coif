-- ---------------------------------------------------------------------------
-- Services catalog data hygiene (Services audit — W2). Mirror of the products
-- W2 migration (20260610150000_products_unique_name_and_status.sql).
--
-- 1) UNIQUE (shop_id, name) on services AND service_categories. product_brands
--    and product_categories ship `unique (shop_id, name)` since init
--    (20260523000001_init_schema.sql:243,252) and products aligned in
--    20260610150000 — but the services side never did: two "Coupe homme" rows
--    in one shop are a data-entry footgun (ambiguous booking picker, CSV
--    export, duplicate drag-reorder rows). Align both services tables on the
--    same per-shop-unique-name rule. The 23505 these indexes raise is mapped
--    to err('CONFLICT', { name: 'duplicate' }) in services/actions.ts (W2).
--
-- 2) Backfill service_categories.sort_order. The column has carried
--    `default 0` since init and there is no category-reorder UI yet, so any
--    category created through the app sits at 0 → the per-shop list order is
--    NON-DETERMINISTIC (no tiebreaker in the reads). Rank choice: created_at
--    (oldest first, id as tiebreaker for same-instant inserts) — it preserves
--    the insertion order users have been seeing, whereas ranking by name
--    would silently re-alphabetize existing shops. Only shops whose
--    categories are ALL still at the default 0 are touched: the seed
--    (supabase/seed.sql:101-106) assigns explicit 1/2/3 and must not be
--    re-ranked. createServiceCategory now appends at max+1 (W2), so this
--    state never regresses.
--
-- ⚠ PRE-DEPLOY (prod): the unique indexes FAIL to build if duplicates already
--    exist. Verify BOTH tables first:
--      select shop_id, name, count(*) from public.services
--      group by shop_id, name having count(*) > 1;
--      select shop_id, name, count(*) from public.service_categories
--      group by shop_id, name having count(*) > 1;
--    Expected EMPTY — the seed has no per-shop name dupes (14 distinct
--    services, 3 distinct categories). If any row returns, rename/merge
--    before applying.
--
-- Re-runnable: `if not exists` on both indexes; the backfill only matches
-- shops still in the all-zero state (a re-run re-ranks them to the same
-- values — single-category shops stay at 0 by construction).
-- ---------------------------------------------------------------------------

-- 1) Per-shop unique names (mirrors product_brands / product_categories /
--    products).
create unique index if not exists services_shop_name_unique
  on public.services (shop_id, name);

create unique index if not exists service_categories_shop_name_unique
  on public.service_categories (shop_id, name);

-- 2) Deterministic category order for shops never ranked (all rows at the
--    default 0). created_at preserves perceived insertion order; id breaks
--    same-instant ties.
update public.service_categories sc
set sort_order = ranked.rn
from (
  select id,
         row_number() over (partition by shop_id order by created_at, id) - 1 as rn
  from public.service_categories
  where shop_id in (
    select shop_id
    from public.service_categories
    group by shop_id
    having bool_and(sort_order = 0)
  )
) ranked
where ranked.id = sc.id
  and sc.sort_order is distinct from ranked.rn;
