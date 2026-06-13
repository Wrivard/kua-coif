-- 20260613180000_audit_log_null_shop_kua_admin.sql
--
-- SOP-08 — restrict NULL-shop audit_log rows to Küa admins.
--
-- The original policy (20260523000002_rls.sql) was:
--   using (shop_id is null or public.has_role_in_shop(shop_id, 'manager'))
-- The `shop_id is null` branch is role-agnostic, so the rows `tg_audit_log`
-- writes with a NULL shop_id (when it cannot derive one from the mutated row)
-- were readable by ANY authenticated caller over the REST API — a minor
-- cross-tenant read if a sensitive event ever lands there.
--
-- Fix: managers still read the audit rows of shops where they are manager+;
-- NULL-shop rows are now visible only to Küa admins. There is no
-- `is_kua_admin()` SQL helper in this repo — the established convention is an
-- inline `profiles.is_kua_admin` subquery (see shops_insert_kua_admin_only,
-- platform_config, widget_events), mirrored here. The audit-log admin page
-- selects with an explicit `.eq('shop_id', …)`, so it never relied on the
-- NULL-shop branch.
--
-- Idempotent: drop before recreate. Only this SELECT policy changes — the
-- `tg_audit_log` trigger and the (deliberately absent) write policies are
-- untouched.

drop policy if exists "audit_log_select_managers" on public.audit_log;

create policy "audit_log_select_managers" on public.audit_log
  for select using (
    public.has_role_in_shop(shop_id, 'manager')
    or (
      shop_id is null
      and exists (
        select 1
        from public.profiles
        where id = (select auth.uid()) and is_kua_admin = true
      )
    )
  );

comment on policy "audit_log_select_managers" on public.audit_log is
  'SOP-08 — managers read audit rows for shops where they hold manager+; NULL-shop rows (trigger could not derive a shop_id) are visible only to Küa admins (profiles.is_kua_admin), closing a cross-tenant read of NULL-shop rows over the REST API.';
