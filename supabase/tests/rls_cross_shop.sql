-- =============================================================================
-- rls_cross_shop.sql
-- Regression test: a member of shop A must NEVER see/write rows of shop B.
--
-- Run with:
--   supabase test db   (uses the local CLI)
-- or, against any Postgres reachable via psql:
--   psql "$DATABASE_URL" -f supabase/tests/rls_cross_shop.sql
--
-- The test creates two synthetic users + shops in a transaction and rolls back
-- at the end, so it's safe to run repeatedly.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Helper: switch the connection to behave as "authenticated user <uuid>".
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
-- Setup — bypass RLS to provision fixtures.
-- ---------------------------------------------------------------------------
set local role postgres;

-- Two fake auth users (we insert directly into auth.users for the test).
do $$
declare
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_shop_a uuid;
  v_shop_b uuid;
  v_visible_count int;
begin
  insert into auth.users (id, email, instance_id, aud, role, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values
    (v_user_a, 'rls-test-a@example.com', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', '', now(), now(), now()),
    (v_user_b, 'rls-test-b@example.com', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', '', now(), now(), now());

  -- Profiles get auto-created by the trigger. Provision shops + memberships:
  insert into public.shops (name, country) values ('Shop A — test', 'Canada')
    returning id into v_shop_a;
  insert into public.shops (name, country) values ('Shop B — test', 'Canada')
    returning id into v_shop_b;

  insert into public.shop_members (shop_id, user_id, role, status)
    values (v_shop_a, v_user_a, 'owner', 'confirmed'),
           (v_shop_b, v_user_b, 'owner', 'confirmed');

  -- One client in each shop.
  insert into public.clients (shop_id, first_name, phone)
    values (v_shop_a, 'Alice', '+15555550001'),
           (v_shop_b, 'Bob',   '+15555550002');

  -- -------------------------------------------------------------------------
  -- Test 1: user A sees only shop A's clients.
  -- -------------------------------------------------------------------------
  perform pg_temp.act_as(v_user_a);
  select count(*) into v_visible_count from public.clients;
  if v_visible_count <> 1 then
    raise exception 'RLS LEAK: user A should see 1 client, saw %', v_visible_count;
  end if;

  if exists (select 1 from public.clients where first_name = 'Bob') then
    raise exception 'RLS LEAK: user A is able to read shop B''s client (Bob)';
  end if;

  -- -------------------------------------------------------------------------
  -- Test 2: user A cannot insert a client into shop B.
  -- -------------------------------------------------------------------------
  begin
    insert into public.clients (shop_id, first_name) values (v_shop_b, 'Mallory');
    raise exception 'RLS LEAK: user A inserted into shop B';
  exception when others then
    -- expected — the policy must reject this.
    null;
  end;

  -- -------------------------------------------------------------------------
  -- Test 3: user B mirror check.
  -- -------------------------------------------------------------------------
  perform pg_temp.act_as(v_user_b);
  select count(*) into v_visible_count from public.clients;
  if v_visible_count <> 1 then
    raise exception 'RLS LEAK: user B should see 1 client, saw %', v_visible_count;
  end if;
  if exists (select 1 from public.clients where first_name = 'Alice') then
    raise exception 'RLS LEAK: user B is able to read shop A''s client (Alice)';
  end if;

  -- -------------------------------------------------------------------------
  -- Test 4: anonymous (no auth.uid) sees nothing.
  -- -------------------------------------------------------------------------
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  select count(*) into v_visible_count from public.clients;
  if v_visible_count <> 0 then
    raise exception 'RLS LEAK: anonymous user can see % client rows', v_visible_count;
  end if;

  raise notice 'rls_cross_shop tests PASSED';
end$$;

rollback;
