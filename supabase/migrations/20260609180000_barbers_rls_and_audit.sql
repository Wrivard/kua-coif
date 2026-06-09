-- ---------------------------------------------------------------------------
-- Barbers RLS hardening (B9) + audit trigger (B4) — Barbers audit.
--
-- ⚠️ Access-boundary change. Mirrors the calendar per-command hardening
-- (20260607130000) and the commission_tiers manager guard. The Server Action
-- layer ALREADY enforces minRole='manager', so this is defense-in-depth: it
-- closes the direct-PostgREST bypass where a barber-role in-browser anon JWT
-- could rename/soft-delete any colleague or rewrite the whole settings grid
-- (the previous `for all using is_shop_member(shop_id)` policy was shop-WIDE,
-- so the manager-only restriction lived only in app code).
--
-- Model: SELECT = any shop member (the admin pages + booking need to read the
-- roster); INSERT/UPDATE/DELETE = manager+ only. has_role_in_shop(shop_id,
-- 'manager') returns true for owner+manager (rank-based).
--
-- Re-runnable (drop if exists). barber_settings writes now flow through the
-- service-role save_barber_settings RPC (which bypasses RLS), so these write
-- policies only constrain direct PostgREST attempts — no legitimate caller is
-- affected.
-- ---------------------------------------------------------------------------

-- barbers --------------------------------------------------------------------
drop policy if exists "barbers_rw" on public.barbers;
drop policy if exists "barbers_select" on public.barbers;
drop policy if exists "barbers_insert" on public.barbers;
drop policy if exists "barbers_update" on public.barbers;
drop policy if exists "barbers_delete" on public.barbers;

create policy "barbers_select" on public.barbers
  for select using (public.is_shop_member(shop_id));
create policy "barbers_insert" on public.barbers
  for insert with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "barbers_update" on public.barbers
  for update
  using (public.has_role_in_shop(shop_id, 'manager'))
  with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "barbers_delete" on public.barbers
  for delete using (public.has_role_in_shop(shop_id, 'manager'));

-- barber_settings ------------------------------------------------------------
drop policy if exists "barber_settings_rw" on public.barber_settings;
drop policy if exists "barber_settings_select" on public.barber_settings;
drop policy if exists "barber_settings_insert" on public.barber_settings;
drop policy if exists "barber_settings_update" on public.barber_settings;
drop policy if exists "barber_settings_delete" on public.barber_settings;

create policy "barber_settings_select" on public.barber_settings
  for select using (public.is_shop_member(shop_id));
create policy "barber_settings_insert" on public.barber_settings
  for insert with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "barber_settings_update" on public.barber_settings
  for update
  using (public.has_role_in_shop(shop_id, 'manager'))
  with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "barber_settings_delete" on public.barber_settings
  for delete using (public.has_role_in_shop(shop_id, 'manager'));

-- Audit trigger on barbers (B4) — barber create/update/soft-delete/status flips
-- previously left NO trail (no trigger + the manual logAuditAction is
-- RLS-dropped). The CRUD actions use the user-session client, so the trigger
-- captures the actor via auth.uid(). barber_settings is NOT triggered here: its
-- save goes through the service-role RPC (no auth.uid()), so it's audited by
-- the actor-attributed logDurableAudit summary in saveBarberSettings instead.
drop trigger if exists audit_log_barbers on public.barbers;
create trigger audit_log_barbers
  after insert or update or delete on public.barbers
  for each row execute procedure public.tg_audit_log();
