-- Security audit #1 (CRITICAL) — restrict role + status writes on shop_members.
--
-- Pre-fix, the RLS policy `shop_members_update` only required
-- `has_role_in_shop(shop_id, 'manager')`. The Server Action layer
-- (Phase H+4 audit fix in app/[locale]/(app)/settings/users/actions.ts)
-- added two business guards:
--   - Only owners can grant or revoke the `owner` role.
--   - No one can edit their own role/status.
--
-- But the Server Action layer is bypassable: a manager who knows the
-- Supabase URL + their JWT can hit /rest/v1/shop_members?id=eq.X with
-- a PATCH body `{"role": "owner"}` and the old RLS policy approved it.
-- This migration mirrors the Server Action's guards into the RLS layer
-- itself so the privilege escalation is blocked end-to-end.
--
-- Strategy:
--   - DROP the old single update policy.
--   - CREATE a new policy that:
--     * still gates on `has_role_in_shop(shop_id, 'manager')`
--     * blocks self-edit via `user_id <> auth.uid()`
--     * blocks role grants/revokes unless caller is owner via a
--       `with check` constraint comparing the new role against the
--       old one (visible via the `old` reference in PG 15+ RLS).
--
-- Postgres 15 RLS doesn't expose `old.role` in CHECK clauses directly,
-- but we can use a subquery against the same table to read the current
-- value. The subquery sees the BEFORE-update row because RLS evaluates
-- USING before the UPDATE happens. WITH CHECK then sees the AFTER-
-- update row. So we compare them.

drop policy if exists "shop_members_update" on public.shop_members;

create policy "shop_members_update"
  on public.shop_members
  for update
  using (
    -- Read gate: must be at least manager in the shop.
    public.has_role_in_shop(shop_id, 'manager')
    -- Cannot edit own row.
    and user_id <> (select auth.uid())
  )
  with check (
    -- Write gate: still must be manager.
    public.has_role_in_shop(shop_id, 'manager')
    -- Still cannot transition to self (no row-swap trick).
    and user_id <> (select auth.uid())
    -- Role change: only owner can grant or revoke `owner`. We compare
    -- the NEW role (visible here in WITH CHECK) against the old one
    -- (read via a subquery — the row hasn't committed yet, but the
    -- pre-update value is what's in the table at this point in the
    -- transaction).
    and (
      role = (select sm.role from public.shop_members sm where sm.id = shop_members.id)
      or public.has_role_in_shop(shop_id, 'owner')
    )
  );

comment on policy "shop_members_update" on public.shop_members is
  'Phase H+5 security #1 — RLS-layer enforcement of: (a) only managers+ can update, (b) cannot self-edit, (c) role grants/revokes of `owner` require owner caller. Mirrors the Server Action guards in settings/users/actions.ts so the privilege escalation is blocked end-to-end (REST API + Server Action).';
