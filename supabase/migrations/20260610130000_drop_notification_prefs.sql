-- Plan 025f — drop the dead `notification_prefs` table.
--
-- Superseded by `notification_automations` (per-(shop, kind, channel) enable
-- toggles managed from /settings/notifications) since Phase 25. The old table
-- has ZERO readers and ZERO writers in the application — evidence:
--   grep -rn "notification_prefs" app lib   →   (no matches)
-- It was created in 20260523000001..3 and seeded in supabase/seed.sql; this
-- migration removes it from the live schema and the seed block is deleted in
-- the same change. Sitting in the schema with no consumers only misleads every
-- reader about where notification preferences actually live.
--
-- `db/types.ts` regenerates at the next deploy (pnpm db:types:local/:remote);
-- it is not hand-edited here.

drop table if exists public.notification_prefs;
