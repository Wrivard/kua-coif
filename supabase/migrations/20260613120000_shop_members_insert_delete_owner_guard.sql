-- =============================================================================
-- 20260613120000_shop_members_insert_delete_owner_guard.sql
-- Security W1a — close the manager→owner privilege escalation on the INSERT
-- and DELETE policies of shop_members.
--
-- Companion to 20260528070000_shop_members_role_rls_guard.sql, which hardened
-- only UPDATE. Pre-fix, `shop_members_insert` and `shop_members_delete` gated
-- solely on `has_role_in_shop(shop_id,'manager')`, so a manager hitting
-- PostgREST directly with their JWT could:
--   - INSERT a `role='owner'` row (mint an owner, or self-promote after
--     DELETEing their own manager row), and
--   - DELETE the owner's row (hostile takeover / lock-out).
-- Same escalation class 20260528070000 fixed for UPDATE, left open on the
-- symmetric INSERT/DELETE paths.
--
-- Strategy — mirror the owner-guard:
--   INSERT: WITH CHECK reads the NEW row's `role`.
--   DELETE: USING reads the target (existing) row's `role`.
-- A manager keeps insert/delete on NON-owner rows; touching an `owner` row
-- requires `has_role_in_shop(shop_id,'owner')`. No OLD/NEW subquery is needed
-- (unlike the UPDATE guard, which had to compare old vs new role).
--
-- Legitimate super-admin + in-app invites run through the SERVICE-ROLE client
-- (bypassrls), so this guard does not touch them — it only constrains a
-- manager calling PostgREST directly with their own JWT.
-- =============================================================================

drop policy if exists "shop_members_insert" on public.shop_members;

create policy "shop_members_insert"
  on public.shop_members
  for insert
  with check (
    public.has_role_in_shop(shop_id, 'manager')
    and (
      role <> 'owner'
      or public.has_role_in_shop(shop_id, 'owner')
    )
  );

drop policy if exists "shop_members_delete" on public.shop_members;

create policy "shop_members_delete"
  on public.shop_members
  for delete
  using (
    public.has_role_in_shop(shop_id, 'manager')
    and (
      role <> 'owner'
      or public.has_role_in_shop(shop_id, 'owner')
    )
  );

comment on policy "shop_members_insert" on public.shop_members is
  'W1a security — mirrors 20260528070000 (UPDATE) onto INSERT: only an owner can create an `owner` row; managers may still add non-owner members. Service-role bypasses RLS so super-admin/in-app invites are unaffected.';

comment on policy "shop_members_delete" on public.shop_members is
  'W1a security — mirrors 20260528070000 (UPDATE) onto DELETE: only an owner can remove an `owner` row; managers may still remove non-owner members. Service-role bypasses RLS.';
