-- ---------------------------------------------------------------------------
-- Atomic overlap prevention for appointments (calendar audit fix).
--
-- The partial UNIQUE index `appointments_unique_active_slot` only catches
-- collisions at the SAME start_at. Two concurrent admin creates of
-- overlapping-but-different-start appointments (e.g. 09:00–09:30 and
-- 09:15–09:45) both pass the app-level checkAvailability (TOCTOU) and both
-- insert. This EXCLUDE constraint makes Postgres reject any duration overlap
-- for the same barber atomically. The range is half-open `[)`, so a booking
-- that ends exactly when the next one starts (10:00 end / 10:00 start) is NOT
-- treated as an overlap.
--
-- Requires the btree_gist extension + a GiST range index, both already
-- provisioned in 20260523000003_indexes_triggers.sql.
--
-- DEPLOY SAFETY: this migration is idempotent (skips if the constraint is
-- already present) and PRE-FLIGHTS the table — if live overlapping rows
-- already exist (data corruption from the TOCTOU window this constraint
-- closes), it raises a clear, counted error BEFORE attempting the constraint,
-- instead of failing with the opaque "conflicting key value violates
-- exclusion constraint". Resolve the offending rows, then re-run.
--
-- Diagnostic — list the offending live overlap pairs to resolve by hand:
--   select a.id a_id, a.start_at a_start, a.end_at a_end,
--          b.id b_id, b.start_at b_start, b.end_at b_end, a.barber_id
--     from public.appointments a
--     join public.appointments b
--       on a.barber_id = b.barber_id and a.id < b.id
--      and a.status not in ('cancelled','no_show')
--      and b.status not in ('cancelled','no_show')
--      and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(b.start_at, b.end_at, '[)');
-- ---------------------------------------------------------------------------

do $$
declare
  v_overlaps int;
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'appointments_no_overlap'
      and conrelid = 'public.appointments'::regclass
  ) then
    raise notice 'constraint appointments_no_overlap already present — skipping';
    return;
  end if;

  select count(*) into v_overlaps
  from public.appointments a
  join public.appointments b
    on a.barber_id = b.barber_id
   and a.id < b.id
   and a.status not in ('cancelled', 'no_show')
   and b.status not in ('cancelled', 'no_show')
   and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(b.start_at, b.end_at, '[)');

  if v_overlaps > 0 then
    raise exception
      'Cannot add appointments_no_overlap: % overlapping live appointment pair(s) already exist. Resolve them first (run the diagnostic SELECT in this migration''s header comment), then re-run this migration.',
      v_overlaps;
  end if;

  alter table public.appointments
    add constraint appointments_no_overlap
    exclude using gist (
      barber_id with =,
      tstzrange(start_at, end_at, '[)') with &&
    )
    where (status not in ('cancelled', 'no_show'));
end$$;
