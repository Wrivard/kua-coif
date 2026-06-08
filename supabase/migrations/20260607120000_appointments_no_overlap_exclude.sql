-- ---------------------------------------------------------------------------
-- Atomic overlap prevention for appointments (calendar audit fix).
--
-- The partial UNIQUE index `appointments_unique_active_slot` only catches
-- collisions at the SAME start_at. Two concurrent admin creates of
-- overlapping-but-different-start appointments (e.g. 09:00–09:30 and
-- 09:15–09:45) both pass the app-level checkAvailability (TOCTOU) and both
-- insert. This EXCLUDE constraint makes Postgres reject any duration overlap
-- for the same barber atomically.
--
-- Requires the btree_gist extension + a GiST range index, both already
-- provisioned in 20260523000003_indexes_triggers.sql.
--
-- ⚠️ DEPLOY NOTE: adding an EXCLUDE constraint FAILS if the table already
-- contains overlapping live rows. If `supabase db push` errors with
-- "conflicting key value violates exclusion constraint", clean up the
-- pre-existing overlaps first (they are data corruption from the TOCTOU
-- window this constraint closes), then re-run.
-- ---------------------------------------------------------------------------

alter table public.appointments
  add constraint appointments_no_overlap
  exclude using gist (
    barber_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  )
  where (status not in ('cancelled', 'no_show'));
