-- Phase F SR — fix `platform_config.updated_by` FK behavior.
--
-- The original migration left the FK with the default `NO ACTION` on
-- delete. That means: deleting a profiles row (which cascades from a
-- `auth.users` delete per the init_schema FK) FAILS as long as that
-- user's UUID is referenced in `platform_config.updated_by`. The block
-- propagates all the way up — even an account deletion via the Supabase
-- Auth dashboard returns an error.
--
-- The fix is `ON DELETE SET NULL`: when the super-admin who made the
-- last save is later deleted, the row keeps the audit timestamp + BPS
-- but blanks the "by" link. The admin UI already handles a null
-- `updated_by` (displays the timestamp without the email line).

alter table public.platform_config
  drop constraint if exists platform_config_updated_by_fkey;

alter table public.platform_config
  add constraint platform_config_updated_by_fkey
  foreign key (updated_by) references public.profiles(id) on delete set null;
