-- ---------------------------------------------------------------------------
-- Barbers audit B15 (uniqueness) + B17 (per-barber bookability).
--
-- B15 — nothing prevented duplicate barbers in a shop (same email or
-- personnel_id), unlike clients which got dedup-on-create. Add partial unique
-- indexes scoped to NON-deleted rows (so a soft-deleted barber's email/id can
-- be reused) and case-insensitive on email. createBarber maps the resulting
-- 23505 to a CONFLICT.
--
-- B17 — a barber could only be hidden from public booking by soft-deleting
-- them, which ALSO removes their admin-calendar column. `bookable` decouples
-- the two: a confirmed barber with bookable=false stays on the calendar +
-- roster but is excluded from /book, the embed widget, the slots API, and the
-- booking action. Defaults true so existing barbers are unchanged.
-- ---------------------------------------------------------------------------

create unique index if not exists barbers_shop_email_unique
  on public.barbers (shop_id, lower(email))
  where email is not null and status <> 'deleted';

create unique index if not exists barbers_shop_personnel_unique
  on public.barbers (shop_id, personnel_id)
  where personnel_id is not null and status <> 'deleted';

alter table public.barbers
  add column if not exists bookable boolean not null default true;
