-- ---------------------------------------------------------------------------
-- Transactional barber-settings save (Barbers audit B1 + B11).
--
-- The previous app-layer upsert (settings/barbers/actions.ts) was broken:
-- supabase-js `.update()` without `{count:'exact'}` returns count=null, so the
-- "if 0 rows then insert" branch ALWAYS fired — the redundant insert hit the
-- partial unique index and errored, but that error was swallowed. Result:
-- silent data loss whenever the UPDATE itself errored on an existing row, and
-- the N+1 writes (shop row + per-barber rows) were non-atomic, so a mid-batch
-- failure left the grid half-saved with a green toast.
--
-- This function does the whole grid in ONE transaction (a plpgsql function
-- body is atomic within its calling statement). It uses the real partial
-- unique indexes as ON CONFLICT arbiters, and validates every barber-scope
-- barber_id belongs to p_shop (B11 — closes the cross-tenant settings-insert /
-- unique-slot-squat vector).
--
-- SECURITY DEFINER + granted to service_role ONLY: it bypasses RLS, so it must
-- never be browser-callable. The caller (saveBarberSettings, manager-gated via
-- withAction) invokes it with the validated active ctx.shopId as p_shop.
-- ---------------------------------------------------------------------------

create or replace function public.save_barber_settings(p_shop uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bad_barber uuid;
  v_shop_count integer := 0;
  v_barber_count integer := 0;
begin
  -- B11 — every per-barber row's barber_id must belong to this shop.
  select r.barber_id into v_bad_barber
  from jsonb_to_recordset(p_rows) as r(scope text, barber_id uuid)
  where r.scope = 'barber'
    and r.barber_id is not null
    and not exists (
      select 1 from public.barbers b where b.id = r.barber_id and b.shop_id = p_shop
    )
  limit 1;
  if v_bad_barber is not null then
    raise exception 'barber % does not belong to shop %', v_bad_barber, p_shop;
  end if;

  -- Shop-default row (scope='shop', barber_id null) → upsert on the partial
  -- unique index barber_settings_shop_unique (shop_id) WHERE scope='shop'.
  insert into public.barber_settings (
    shop_id, scope, barber_id,
    allow_booking_wo_payment, booking_tip, confirmation_tip, allow_multiple_services,
    client_booking_interval_min, barber_booking_interval_min,
    days_book_in_advance, mins_book_before_appt,
    customer_cancellations, mins_cancel_before_appt,
    reminder1_h, reminder1_m, reminder2_h, reminder2_m
  )
  select
    p_shop, 'shop', null,
    r.allow_booking_wo_payment, r.booking_tip, r.confirmation_tip, r.allow_multiple_services,
    r.client_booking_interval_min, r.barber_booking_interval_min,
    r.days_book_in_advance, r.mins_book_before_appt,
    r.customer_cancellations, r.mins_cancel_before_appt,
    r.reminder1_h, r.reminder1_m, r.reminder2_h, r.reminder2_m
  from jsonb_to_recordset(p_rows) as r(
    scope text,
    allow_booking_wo_payment boolean, booking_tip boolean, confirmation_tip boolean,
    allow_multiple_services boolean,
    client_booking_interval_min integer, barber_booking_interval_min integer,
    days_book_in_advance integer, mins_book_before_appt integer,
    customer_cancellations boolean, mins_cancel_before_appt integer,
    reminder1_h integer, reminder1_m integer, reminder2_h integer, reminder2_m integer
  )
  where r.scope = 'shop'
  on conflict (shop_id) where (scope = 'shop')
  do update set
    allow_booking_wo_payment = excluded.allow_booking_wo_payment,
    booking_tip = excluded.booking_tip,
    confirmation_tip = excluded.confirmation_tip,
    allow_multiple_services = excluded.allow_multiple_services,
    client_booking_interval_min = excluded.client_booking_interval_min,
    barber_booking_interval_min = excluded.barber_booking_interval_min,
    days_book_in_advance = excluded.days_book_in_advance,
    mins_book_before_appt = excluded.mins_book_before_appt,
    customer_cancellations = excluded.customer_cancellations,
    mins_cancel_before_appt = excluded.mins_cancel_before_appt,
    reminder1_h = excluded.reminder1_h,
    reminder1_m = excluded.reminder1_m,
    reminder2_h = excluded.reminder2_h,
    reminder2_m = excluded.reminder2_m;
  get diagnostics v_shop_count = row_count;

  -- Per-barber rows (scope='barber') → upsert on barber_settings_barber_unique
  -- (barber_id) WHERE scope='barber'.
  insert into public.barber_settings (
    shop_id, scope, barber_id,
    allow_booking_wo_payment, booking_tip, confirmation_tip, allow_multiple_services,
    client_booking_interval_min, barber_booking_interval_min,
    days_book_in_advance, mins_book_before_appt,
    customer_cancellations, mins_cancel_before_appt,
    reminder1_h, reminder1_m, reminder2_h, reminder2_m
  )
  select
    p_shop, 'barber', r.barber_id,
    r.allow_booking_wo_payment, r.booking_tip, r.confirmation_tip, r.allow_multiple_services,
    r.client_booking_interval_min, r.barber_booking_interval_min,
    r.days_book_in_advance, r.mins_book_before_appt,
    r.customer_cancellations, r.mins_cancel_before_appt,
    r.reminder1_h, r.reminder1_m, r.reminder2_h, r.reminder2_m
  from jsonb_to_recordset(p_rows) as r(
    scope text, barber_id uuid,
    allow_booking_wo_payment boolean, booking_tip boolean, confirmation_tip boolean,
    allow_multiple_services boolean,
    client_booking_interval_min integer, barber_booking_interval_min integer,
    days_book_in_advance integer, mins_book_before_appt integer,
    customer_cancellations boolean, mins_cancel_before_appt integer,
    reminder1_h integer, reminder1_m integer, reminder2_h integer, reminder2_m integer
  )
  where r.scope = 'barber' and r.barber_id is not null
  on conflict (barber_id) where (scope = 'barber')
  do update set
    allow_booking_wo_payment = excluded.allow_booking_wo_payment,
    booking_tip = excluded.booking_tip,
    confirmation_tip = excluded.confirmation_tip,
    allow_multiple_services = excluded.allow_multiple_services,
    client_booking_interval_min = excluded.client_booking_interval_min,
    barber_booking_interval_min = excluded.barber_booking_interval_min,
    days_book_in_advance = excluded.days_book_in_advance,
    mins_book_before_appt = excluded.mins_book_before_appt,
    customer_cancellations = excluded.customer_cancellations,
    mins_cancel_before_appt = excluded.mins_cancel_before_appt,
    reminder1_h = excluded.reminder1_h,
    reminder1_m = excluded.reminder1_m,
    reminder2_h = excluded.reminder2_h,
    reminder2_m = excluded.reminder2_m;
  get diagnostics v_barber_count = row_count;

  return v_shop_count + v_barber_count;
end;
$$;

-- Supabase's default privileges grant EXECUTE to anon/authenticated DIRECTLY
-- (not only via PUBLIC), so revoke from all three explicitly. This function
-- bypasses RLS and trusts p_shop, so it must be service-role-only (server-side
-- callers); a `revoke from public` alone would leave authenticated able to
-- overwrite ANY shop's settings.
revoke execute on function public.save_barber_settings(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_barber_settings(uuid, jsonb) to service_role;
