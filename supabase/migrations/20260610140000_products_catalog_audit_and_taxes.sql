-- ---------------------------------------------------------------------------
-- Products catalog: audit triggers + atomic, same-shop-validated tax linking
-- (Produits audit — W1, back-end integrity & security).
--
-- Two fixes from the back-end audit:
--
-- 1) AUDIT TRAIL (the "ghost trail"): products / product_brands /
--    product_categories had NO audit_log trigger — the trigger list in
--    20260523000003_indexes_triggers.sql covers clients / appointments /
--    discounts / promo_codes / commission_tiers / payment_profiles only — AND
--    the app-side logAuditAction is a runtime no-op (its user-session insert is
--    dropped by audit_log RLS; only the SECURITY DEFINER trigger writes there).
--    A product price IS money, so its create/update/delete must leave a trail.
--    We attach the existing tg_audit_log() trigger (actor resolved via
--    auth.uid(); the CRUD actions use the user-session client) — exactly the
--    barbers B4 pattern (20260609180000_barbers_rls_and_audit.sql).
--
-- 2) ATOMIC TAX LINKING: set_product_taxes(product_id, tax_ids[]) replaces the
--    app's silent, non-atomic delete-then-insert on product_taxes, and
--    validates every tax belongs to the SAME shop as the product. The M:N RLS
--    only gates on the parent product's shop+role, NOT the tax's shop, so a
--    cross-shop tax_id was attachable; this closes that. A function body is one
--    transaction, so the delete + insert can never leave a half-linked product.
--
-- Re-runnable (drop trigger if exists / create or replace function).
-- ---------------------------------------------------------------------------

-- 1) Audit triggers — mirror the barbers B4 pattern --------------------------
drop trigger if exists audit_log_products on public.products;
create trigger audit_log_products
  after insert or update or delete on public.products
  for each row execute procedure public.tg_audit_log();

drop trigger if exists audit_log_product_brands on public.product_brands;
create trigger audit_log_product_brands
  after insert or update or delete on public.product_brands
  for each row execute procedure public.tg_audit_log();

drop trigger if exists audit_log_product_categories on public.product_categories;
create trigger audit_log_product_categories
  after insert or update or delete on public.product_categories
  for each row execute procedure public.tg_audit_log();

-- 2) set_product_taxes — atomic, same-shop-validated tax linking -------------
-- SECURITY INVOKER (stated explicitly): the CALLER's RLS applies, and that is
-- the whole point. The product_taxes policies already gate writes on
-- "manager of the parent product's shop", and products SELECT is shop-scoped,
-- so an invoker function inherits exactly those guards while running as the
-- authenticated manager. This is the OPPOSITE of the cron/admin RPCs
-- (save_barber_settings, merge_clients) which are SECURITY DEFINER +
-- service_role-only precisely because they intentionally BYPASS RLS — this one
-- must NOT bypass it, so it stays invoker and is granted to authenticated.
create or replace function public.set_product_taxes(p_product_id uuid, p_tax_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_shop_id uuid;
  v_bad_count integer;
begin
  -- (i) Resolve the product's shop. RLS SELECT hides other shops' products, so
  -- a NULL here means "no such product visible to this caller".
  select shop_id into v_shop_id from public.products where id = p_product_id;
  if v_shop_id is null then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;

  -- (ii) Every supplied tax must exist AND belong to the SAME shop. RLS makes
  -- other shops' tax rows invisible anyway, but we assert shop_id explicitly so
  -- the failure is precise regardless of policy shape.
  if p_tax_ids is not null and array_length(p_tax_ids, 1) is not null then
    select count(*) into v_bad_count
    from unnest(p_tax_ids) as t(tax_id)
    where not exists (
      select 1 from public.taxes x where x.id = t.tax_id and x.shop_id = v_shop_id
    );
    if v_bad_count > 0 then
      raise exception 'TAX_WRONG_SHOP';
    end if;
  end if;

  -- (iii) Replace the link set atomically (the function body is one
  -- transaction). `select distinct` collapses any duplicate tax_ids.
  delete from public.product_taxes where product_id = p_product_id;
  if p_tax_ids is not null and array_length(p_tax_ids, 1) is not null then
    insert into public.product_taxes (product_id, tax_id)
    select distinct p_product_id, t.tax_id from unnest(p_tax_ids) as t(tax_id);
  end if;
end;
$$;

-- Invoker function for AUTHENTICATED users, guarded by RLS (see header). Revoke
-- the default PUBLIC/anon execute; grant only to authenticated. Deliberately
-- NOT the service_role-only pattern of the RLS-bypassing definer RPCs — this
-- function must run AS the manager so RLS keeps it inside their shop.
revoke execute on function public.set_product_taxes(uuid, uuid[]) from public, anon;
grant execute on function public.set_product_taxes(uuid, uuid[]) to authenticated;
