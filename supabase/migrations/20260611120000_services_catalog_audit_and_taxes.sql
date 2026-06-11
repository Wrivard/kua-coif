-- ---------------------------------------------------------------------------
-- Services catalog: audit triggers + atomic, same-shop-validated tax linking
-- (Services audit — W1, back-end integrity & security; SVC-BE-01 / SVC-BE-02).
--
-- EXACT mirror of the Products W1 migration
-- (20260610140000_products_catalog_audit_and_taxes.sql) — same two fixes,
-- services flavor:
--
-- 1) AUDIT TRAIL (the "ghost trail"): services / service_categories had NO
--    audit_log trigger — the trigger list in
--    20260523000003_indexes_triggers.sql covers clients / appointments /
--    discounts / promo_codes / commission_tiers / payment_profiles /
--    shop_members (+ barbers via 20260609180000, + products via
--    20260610140000) — AND the app-side logAuditAction is a runtime no-op
--    (its user-session insert is dropped by audit_log RLS; only the SECURITY
--    DEFINER trigger writes there). A service price IS the direct input of
--    the charged amount (price_snapshot / booking-pricing), so its
--    create/update/delete must leave a trail. No trigger on service_taxes:
--    the M:N has neither shop_id nor id, so its audit row would be
--    unfindable (audit_log_shop_time_idx keys on shop_id) — same arbitrage
--    as products (product_taxes carries no trigger either); link changes
--    are captured by the service-row update that accompanies them.
--
-- 2) ATOMIC TAX LINKING: set_service_taxes(service_id, tax_ids[]) replaces
--    the app's silent, non-atomic delete-then-insert on service_taxes, and
--    validates every tax belongs to the SAME shop as the service. The M:N
--    RLS only gates on the parent service's shop+role
--    (catalog_rls_per_command.sql:84-91), NOT the tax's shop, so a
--    cross-shop tax_id was attachable; this closes that. A function body is
--    one transaction, so the delete + insert can never leave a half-linked
--    service (the old path could silently LOSE a service's taxes when the
--    re-insert failed after the delete).
--
-- ⚠ PRE-DEPLOY (prod): the RPC validates NEW writes only — it does not
--    repair links already attached through the RLS gap. Verify none exist:
--      select st.service_id, st.tax_id, s.shop_id as service_shop, x.shop_id as tax_shop
--      from public.service_taxes st
--      join public.services s on s.id = st.service_id
--      join public.taxes x on x.id = st.tax_id
--      where s.shop_id <> x.shop_id;
--    Expected EMPTY. If any row returns, delete those links before (or right
--    after) applying — they would surface a foreign shop's tax on the
--    upcoming receipt breakdown (plan 045), which joins service-role.
--
-- Re-runnable (drop trigger if exists / create or replace function).
-- ---------------------------------------------------------------------------

-- 1) Audit triggers — mirror the products W1 / barbers B4 pattern -----------
drop trigger if exists audit_log_services on public.services;
create trigger audit_log_services
  after insert or update or delete on public.services
  for each row execute procedure public.tg_audit_log();

drop trigger if exists audit_log_service_categories on public.service_categories;
create trigger audit_log_service_categories
  after insert or update or delete on public.service_categories
  for each row execute procedure public.tg_audit_log();

-- 2) set_service_taxes — atomic, same-shop-validated tax linking ------------
-- SECURITY INVOKER (stated explicitly): the CALLER's RLS applies, and that is
-- the whole point. The service_taxes policies already gate writes on
-- "manager of the parent service's shop", and services SELECT is shop-scoped,
-- so an invoker function inherits exactly those guards while running as the
-- authenticated manager. Same stance as set_product_taxes — NOT the
-- service_role-only SECURITY DEFINER pattern of the RLS-bypassing RPCs.
create or replace function public.set_service_taxes(p_service_id uuid, p_tax_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_shop_id uuid;
  v_bad_count integer;
begin
  -- (i) Resolve the service's shop. RLS SELECT hides other shops' services,
  -- so a NULL here means "no such service visible to this caller".
  select shop_id into v_shop_id from public.services where id = p_service_id;
  if v_shop_id is null then
    raise exception 'SERVICE_NOT_FOUND';
  end if;

  -- (ii) Every supplied tax must exist AND belong to the SAME shop. RLS makes
  -- other shops' tax rows invisible anyway, but we assert shop_id explicitly
  -- so the failure is precise regardless of policy shape.
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
  delete from public.service_taxes where service_id = p_service_id;
  if p_tax_ids is not null and array_length(p_tax_ids, 1) is not null then
    insert into public.service_taxes (service_id, tax_id)
    select distinct p_service_id, t.tax_id from unnest(p_tax_ids) as t(tax_id);
  end if;
end;
$$;

-- Invoker function for AUTHENTICATED users, guarded by RLS (see header). Revoke
-- the default PUBLIC/anon execute; grant only to authenticated.
revoke execute on function public.set_service_taxes(uuid, uuid[]) from public, anon;
grant execute on function public.set_service_taxes(uuid, uuid[]) to authenticated;
