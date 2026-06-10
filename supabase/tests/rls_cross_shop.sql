-- =============================================================================
-- rls_cross_shop.sql  (pgTAP)
-- Regression test: a member of shop A must NEVER see/write rows of shop B.
--
-- Real pgTAP (plan / ok / is / throws_ok / finish), consumed by the standard
-- Supabase TAP runner, which boots the local stack:
--   supabase test db
--
-- The suite provisions two synthetic users + shops inside a transaction and
-- rolls back at the end, so it is safe to run repeatedly. Each cross-tenant
-- guarantee maps to exactly one pgTAP assertion (see plan() below).
-- =============================================================================

begin;
create extension if not exists pgtap;
select plan(6);

-- ---------------------------------------------------------------------------
-- Helper: switch the connection to behave as "authenticated user <uuid>".
-- (Unchanged from the original suite. RLS only applies to non-superuser roles,
-- so we MUST drop into `authenticated` for the policies to take effect.)
-- ---------------------------------------------------------------------------
create or replace function pg_temp.act_as(p_user uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_user::text, 'role', 'authenticated')::text,
                     true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Setup — bypass RLS (as postgres) to provision fixtures. Deterministic UUIDs
-- so the assertions below can reference the synthetic shop/user rows directly.
-- ---------------------------------------------------------------------------
set local role postgres;

-- Two fake auth users; profiles are auto-created by the on-auth.users trigger.
insert into auth.users (id, email, instance_id, aud, role, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', 'rls-test-a@example.com',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '',
   now(), now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'rls-test-b@example.com',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '',
   now(), now(), now());

-- A shop per user + the matching owner membership.
insert into public.shops (id, name, country) values
  ('33333333-3333-3333-3333-333333333333', 'Shop A — test', 'Canada'),
  ('44444444-4444-4444-4444-444444444444', 'Shop B — test', 'Canada');

insert into public.shop_members (shop_id, user_id, role, status) values
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'owner', 'confirmed'),
  ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 'owner', 'confirmed');

-- One client in each shop.
insert into public.clients (shop_id, first_name, phone) values
  ('33333333-3333-3333-3333-333333333333', 'Alice', '+15555550001'),
  ('44444444-4444-4444-4444-444444444444', 'Bob',   '+15555550002');

-- ---------------------------------------------------------------------------
-- Test 1: user A (shop A) sees only shop A's clients.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-1111-1111-111111111111'::uuid);

select is(
  (select count(*)::int from public.clients),
  1,
  'owner of shop A sees exactly 1 client (their own shop)'
);

select ok(
  not exists (select 1 from public.clients where first_name = 'Bob'),
  'owner of shop A cannot read shop B''s client (Bob)'
);

-- ---------------------------------------------------------------------------
-- Test 2: user A cannot INSERT a client into shop B (RLS WITH CHECK rejects,
-- SQLSTATE 42501 insufficient_privilege).
-- ---------------------------------------------------------------------------
-- 4-arg form: the 3rd arg is the expected error MESSAGE (3-arg form treated
-- our description as one and failed the maiden CI run) — NULL skips message
-- matching, the 4th arg is the description.
select throws_ok(
  $$insert into public.clients (shop_id, first_name)
    values ('44444444-4444-4444-4444-444444444444', 'Mallory')$$,
  '42501',
  null,
  'owner of shop A cannot insert a client into shop B (RLS rejects)'
);

-- ---------------------------------------------------------------------------
-- Test 3: user B (shop B) mirror check.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('22222222-2222-2222-2222-222222222222'::uuid);

select is(
  (select count(*)::int from public.clients),
  1,
  'owner of shop B sees exactly 1 client (their own shop)'
);

select ok(
  not exists (select 1 from public.clients where first_name = 'Alice'),
  'owner of shop B cannot read shop A''s client (Alice)'
);

-- ---------------------------------------------------------------------------
-- Test 4: anonymous (no auth.uid) sees nothing.
-- ---------------------------------------------------------------------------
select set_config('role', 'anon', true);
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

select is(
  (select count(*)::int from public.clients),
  0,
  'anonymous (no auth.uid) sees zero client rows'
);

-- Reset to the privileged role so finish() is unaffected by the anon context.
set local role postgres;

select * from finish();
rollback;
