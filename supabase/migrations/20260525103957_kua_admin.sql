-- =============================================================================
-- 20260525103957_kua_admin.sql
-- Phase 22 — Super-admin role for the Küa team.
--
-- The whitelist auth model means signups are off (controlled at the Supabase
-- Auth dashboard level) and shop owners are created by **us** via a private
-- /admin/shops route. This migration adds the boolean flag the route gates on.
--
-- Security note: the existing `profiles_update_self` RLS policy lets a user
-- update their own row — including `is_kua_admin` if we did nothing. We close
-- that hole by revoking the column-level UPDATE grant from `anon` and
-- `authenticated`, so the field can only be toggled via the service-role
-- (i.e., from a server-side admin tool we control).
-- =============================================================================

alter table public.profiles
  add column if not exists is_kua_admin boolean not null default false;

-- Column-level grants take precedence over RLS — even if the row-level policy
-- allows the update, this prevents the targeted column from being touched.
revoke update (is_kua_admin) on public.profiles from anon;
revoke update (is_kua_admin) on public.profiles from authenticated;

comment on column public.profiles.is_kua_admin is
  'Marks the user as a member of the Küa team — gates access to /admin/* routes (shop creation, owner invites). Column-level revoke keeps it write-only via service-role.';
