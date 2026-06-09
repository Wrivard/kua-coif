-- ---------------------------------------------------------------------------
-- Calendar RLS hardening — per-command policies for appointments,
-- appointment_services, and blocked_time (calendar audit fix).
--
-- ⚠️⚠️ REVIEW + TEST ON STAGING BEFORE PRODUCTION DEPLOY. ⚠️⚠️
-- This changes the DATA-LAYER access boundary. A wrong policy can lock out
-- barbers or managers. The Server Action layer ALREADY enforces these guards
-- (ownership + role), so this is defense-in-depth — it closes the direct-
-- PostgREST / Realtime bypass where a strict barber's in-browser anon JWT
-- could read / UPDATE / DELETE a COLLEAGUE's appointment (the previous
-- `for all using is_shop_member(shop_id)` policy was shop-WIDE, so the
-- "strict barber" isolation lived only in app code).
--
-- Model (mirrors the shop_members role guard):
--   appointments / appointment_services
--     - manager+ : full access to every row in the shop
--     - barber   : only rows whose barber_id is their OWN chair (the UPDATE
--                  with-check on the NEW barber_id also blocks a barber from
--                  reassigning their appointment to another barber).
--   blocked_time
--     - shop-wide blocks (barber_id IS NULL) are visible to all members but
--       writable by manager+ only; barber-specific blocks follow own-or-manager.
--
-- has_role_in_shop(shop_id,'manager') already returns true for owner+manager
-- (rank-based, see 20260523000001_init_schema.sql).
-- ---------------------------------------------------------------------------

-- Helper: is `p_barber_id` the CALLER's own chair in `p_shop_id`?
create or replace function public.is_own_barber(p_shop_id uuid, p_barber_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.barbers b
    where b.id = p_barber_id
      and b.shop_id = p_shop_id
      and b.user_id = auth.uid()
  );
$$;

-- appointments ---------------------------------------------------------------
-- Drop the prior shop-wide policy AND any prior run of the per-command
-- policies below, so this migration is safely re-runnable.
drop policy if exists "appointments_rw" on public.appointments;
drop policy if exists "appointments_select" on public.appointments;
drop policy if exists "appointments_insert" on public.appointments;
drop policy if exists "appointments_update" on public.appointments;
drop policy if exists "appointments_delete" on public.appointments;

create policy "appointments_select" on public.appointments
  for select using (
    public.is_shop_member(shop_id)
    and (public.has_role_in_shop(shop_id, 'manager') or public.is_own_barber(shop_id, barber_id))
  );

create policy "appointments_insert" on public.appointments
  for insert with check (
    public.is_shop_member(shop_id)
    and (public.has_role_in_shop(shop_id, 'manager') or public.is_own_barber(shop_id, barber_id))
  );

create policy "appointments_update" on public.appointments
  for update
  using (
    public.is_shop_member(shop_id)
    and (public.has_role_in_shop(shop_id, 'manager') or public.is_own_barber(shop_id, barber_id))
  )
  with check (
    public.is_shop_member(shop_id)
    and (public.has_role_in_shop(shop_id, 'manager') or public.is_own_barber(shop_id, barber_id))
  );

create policy "appointments_delete" on public.appointments
  for delete using (
    public.is_shop_member(shop_id)
    and (public.has_role_in_shop(shop_id, 'manager') or public.is_own_barber(shop_id, barber_id))
  );

-- appointment_services -------------------------------------------------------
-- Follow the parent appointment's own-or-manager rule (the old policy only
-- checked is_shop_member, so a barber could read every colleague's service
-- + price rows directly).
drop policy if exists "appointment_services_rw" on public.appointment_services;

create policy "appointment_services_rw" on public.appointment_services
  for all
  using (
    exists (
      select 1
      from public.appointments a
      where a.id = appointment_services.appointment_id
        and public.is_shop_member(a.shop_id)
        and (public.has_role_in_shop(a.shop_id, 'manager') or public.is_own_barber(a.shop_id, a.barber_id))
    )
  )
  with check (
    exists (
      select 1
      from public.appointments a
      where a.id = appointment_services.appointment_id
        and public.is_shop_member(a.shop_id)
        and (public.has_role_in_shop(a.shop_id, 'manager') or public.is_own_barber(a.shop_id, a.barber_id))
    )
  );

-- blocked_time ---------------------------------------------------------------
drop policy if exists "blocked_time_rw" on public.blocked_time;
drop policy if exists "blocked_time_select" on public.blocked_time;
drop policy if exists "blocked_time_insert" on public.blocked_time;
drop policy if exists "blocked_time_update" on public.blocked_time;
drop policy if exists "blocked_time_delete" on public.blocked_time;

create policy "blocked_time_select" on public.blocked_time
  for select using (
    public.is_shop_member(shop_id)
    and (
      public.has_role_in_shop(shop_id, 'manager')
      or barber_id is null  -- shop-wide blocks affect the whole grid → visible to all
      or public.is_own_barber(shop_id, barber_id)
    )
  );

create policy "blocked_time_insert" on public.blocked_time
  for insert with check (
    public.is_shop_member(shop_id)
    and (
      public.has_role_in_shop(shop_id, 'manager')
      or (barber_id is not null and public.is_own_barber(shop_id, barber_id))
    )
  );

create policy "blocked_time_update" on public.blocked_time
  for update
  using (
    public.is_shop_member(shop_id)
    and (
      public.has_role_in_shop(shop_id, 'manager')
      or (barber_id is not null and public.is_own_barber(shop_id, barber_id))
    )
  )
  with check (
    public.is_shop_member(shop_id)
    and (
      public.has_role_in_shop(shop_id, 'manager')
      or (barber_id is not null and public.is_own_barber(shop_id, barber_id))
    )
  );

create policy "blocked_time_delete" on public.blocked_time
  for delete using (
    public.is_shop_member(shop_id)
    and (
      public.has_role_in_shop(shop_id, 'manager')
      or (barber_id is not null and public.is_own_barber(shop_id, barber_id))
    )
  );
