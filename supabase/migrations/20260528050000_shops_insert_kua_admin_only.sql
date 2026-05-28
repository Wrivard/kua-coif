-- Security audit #3 (CRITICAL) — restrict shops INSERT to Küa admins.
--
-- Pre-fix RLS: `with check ((select auth.uid()) is not null)` — any
-- authenticated user could POST /rest/v1/shops and pollute the table:
--   - alias squatting (DoS via unique-constraint contention)
--   - populating slack_webhook_url for cross-shop confusion
--   - reserving display names
--
-- Attacker can't directly own the orphan shop (shop_members_insert
-- requires has_role_in_shop(shop_id, 'manager') which they don't have
-- on a fresh row), but the polluted rows are still a problem.
--
-- Fix: gate INSERT on `is_kua_admin = true`. The legitimate /admin/shops/new
-- path runs via service-role and bypasses RLS — unchanged. Anyone else
-- POSTing to /rest/v1/shops gets rejected.

drop policy if exists shops_insert on public.shops;

create policy shops_insert on public.shops
  for insert
  with check (
    exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and is_kua_admin = true
    )
  );

comment on policy shops_insert on public.shops is
  'Phase H — only Küa admins can create shops via the REST API. The legitimate /admin/shops/new path uses service-role and bypasses RLS; this gate stops anonymous/authenticated shop pollution.';
