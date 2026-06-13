-- =============================================================================
-- 20260613160000_loyalty_promo_concurrency.sql
-- Money concurrency hardening — SM-04 / SM-05 / SM-06.
--
-- Three real-money concurrency bugs on the public booking path
-- (app/[locale]/book/[shopSlug]/actions.ts + lib/business/loyalty.ts):
--   SM-04  one_time promo redeemed via read-check-then-increment (RMW,
--          best-effort, swallowed) → two concurrent bookings both pass the
--          read and both redeem = the discount is double-spent.
--   SM-05  loyalty balance written as an ABSOLUTE value on both the
--          redemption (debit) and the accrual (credit) paths → a booking
--          debit and a completion accrual racing clobber each other (lost
--          update).
--   SM-06  awardLoyaltyOnCompletion is not idempotent → two concurrent
--          completions of the same appointment (both read status='booked')
--          both credit the reward.
--
-- Fix: do every money mutation atomically SQL-side via SECURITY DEFINER
-- functions, plus a per-appointment idempotency marker.
--
-- ⚠ ACCESS CONTROL (critical): PostgreSQL grants EXECUTE to PUBLIC on
-- CREATE FUNCTION and Supabase additionally grants it to anon/authenticated,
-- so without the REVOKE below these RPCs would be callable by ANY web client
-- via PostgREST `/rest/v1/rpc/<fn>` against an ARBITRARY client_id / promo_id /
-- appointment_id = money theft / manipulation (drain a balance, mint promo
-- redemptions, grant rewards). Every legitimate caller is server-side and uses
-- the SERVICE-ROLE client, so we REVOKE EXECUTE from public/anon/authenticated
-- and GRANT it only to service_role — mirrors 20260609170000
-- (merge_clients / purge_old_audit_log). No client-side caller exists.
-- =============================================================================

-- SM-06 — per-appointment idempotency marker. NULL until the loyalty award has
-- been applied for this appointment; the accrual claims it atomically so a
-- re-fired completion is a no-op.
alter table public.appointments
  add column if not exists loyalty_awarded_at timestamptz;

comment on column public.appointments.loyalty_awarded_at is
  'SM-06 — set once when awardLoyaltyOnCompletion credits this appointment; the accrue_loyalty RPC claims it atomically so a re-fired completed transition never double-credits.';

-- ── SM-04 — atomic conditional promo redemption ────────────────────────────
-- The WHERE clause is the authoritative one_time gate: for a one_time code the
-- predicate `redemptions = 0` only holds for the FIRST concurrent claim, so
-- exactly one booking can redeem it. Returns true when a row was claimed.
create or replace function public.claim_promo_redemption(p_promo_id uuid, p_discount numeric)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.promo_codes
     set redemptions = redemptions + 1,
         total_redemption_value = total_redemption_value + p_discount
   where id = p_promo_id
     and (one_time = false or redemptions = 0);
  return found;
end;
$$;

-- Compensation — release a claim when the booking fails AFTER claiming, so a
-- failed booking never permanently consumes a one_time code.
create or replace function public.release_promo_redemption(p_promo_id uuid, p_discount numeric)
returns void
language sql
security definer
set search_path = public
as $$
  update public.promo_codes
     set redemptions = greatest(0, redemptions - 1),
         total_redemption_value = greatest(0::numeric, total_redemption_value - p_discount)
   where id = p_promo_id;
$$;

-- ── SM-05 — atomic loyalty balance debit (redemption) ──────────────────────
-- Single relative UPDATE: Postgres re-reads the row under the row lock, so a
-- concurrent accrual (which ADDS) can't be lost. greatest(0,…) honours the
-- clients.loyalty_balance_cents >= 0 CHECK.
create or replace function public.debit_loyalty_balance(p_client_id uuid, p_amount_cents integer)
returns void
language sql
security definer
set search_path = public
as $$
  update public.clients
     set loyalty_balance_cents = greatest(0, loyalty_balance_cents - p_amount_cents)
   where id = p_client_id;
$$;

-- ── SM-05 + SM-06 — atomic, idempotent loyalty accrual ─────────────────────
-- Mirrors the arithmetic of computeLoyaltyProgress() in lib/business/loyalty.ts
-- (kept there as the unit-tested reference; the lib can't run this SQL). The
-- SELECT … FOR UPDATE serialises concurrent accruals for the same client so
-- neither the counter nor the balance is lost; the loyalty_awarded_at claim
-- makes a re-fired completion a no-op. Returns the reward cents granted (0 when
-- nothing was granted OR the appointment was already awarded).
create or replace function public.accrue_loyalty(
  p_appointment_id uuid,
  p_client_id uuid,
  p_type text,
  p_goal_count integer,
  p_reward_cents integer,
  p_total_cents integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_counter integer;
  v_balance integer;
  v_goal_cents integer;
  v_next integer;
  v_reward integer := 0;
begin
  -- SM-06 — claim this appointment exactly once. A re-fire finds the column
  -- already set and no-ops.
  update public.appointments
     set loyalty_awarded_at = now()
   where id = p_appointment_id
     and loyalty_awarded_at is null;
  if not found then
    return 0;
  end if;

  -- SM-05 — lock the client row so the read-compute-write below can't lose an
  -- update to a concurrent accrual; a concurrent debit_loyalty_balance blocks
  -- on the same lock and applies on the committed balance.
  select loyalty_counter, loyalty_balance_cents
    into v_counter, v_balance
    from public.clients
   where id = p_client_id
     for update;
  if not found then
    return 0;
  end if;

  if p_type = 'value' then
    -- counter carries cumulative CENTS spent; goal_count is the dollar goal.
    v_goal_cents := p_goal_count * 100;
    if v_goal_cents > 0 and v_counter + p_total_cents >= v_goal_cents then
      v_reward := p_reward_cents;
      v_next := v_counter + p_total_cents - v_goal_cents;
    else
      v_next := v_counter + p_total_cents;
    end if;
  else
    -- transaction mode: +1 per qualifying visit, reset on a hit.
    if v_counter + 1 >= p_goal_count then
      v_reward := p_reward_cents;
      v_next := 0;
    else
      v_next := v_counter + 1;
    end if;
  end if;

  update public.clients
     set loyalty_counter = v_next,
         loyalty_balance_cents = v_balance + v_reward,
         loyalty_balance_expires_at = case
           when v_reward > 0 then now() + interval '1 year'
           else loyalty_balance_expires_at
         end
   where id = p_client_id;

  return v_reward;
end;
$$;

-- ── Access control — service-role only (see header) ────────────────────────
revoke execute on function public.claim_promo_redemption(uuid, numeric) from public, anon, authenticated;
grant  execute on function public.claim_promo_redemption(uuid, numeric) to service_role;

revoke execute on function public.release_promo_redemption(uuid, numeric) from public, anon, authenticated;
grant  execute on function public.release_promo_redemption(uuid, numeric) to service_role;

revoke execute on function public.debit_loyalty_balance(uuid, integer) from public, anon, authenticated;
grant  execute on function public.debit_loyalty_balance(uuid, integer) to service_role;

revoke execute on function public.accrue_loyalty(uuid, uuid, text, integer, integer, integer) from public, anon, authenticated;
grant  execute on function public.accrue_loyalty(uuid, uuid, text, integer, integer, integer) to service_role;
