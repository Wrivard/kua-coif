-- CI-only e2e login user.
--
-- Applied AFTER `supabase db reset` in the `e2e` job of
-- .github/workflows/db-e2e.yml (NOT part of supabase/seed.sql, so prod/remote
-- seeding never pulls it in). It provisions a confirmed auth user that can sign
-- in through the password form and links it to the Axum seed shop as an owner,
-- so the admin calendar renders the 22 May 2026 seed appointments the
-- Playwright specs assert on.
--
-- DO NOT apply to any real/remote database — it inserts a known-password
-- account. Credentials are matched by the e2e job's PLAYWRIGHT_USER_EMAIL /
-- PLAYWRIGHT_USER_PASSWORD env.
--
-- Idempotent: re-running against a warm DB is a no-op for the user, identity,
-- and membership. The auth.users insert fires on_auth_user_created, which
-- auto-creates the matching public.profiles row (see migration
-- 20260523000003); shop_members.user_id references profiles(id).

-- crypt()/gen_salt() for the bcrypt password hash GoTrue verifies on login.
create extension if not exists pgcrypto;

do $$
declare
  v_user_id uuid;
  v_shop_id uuid;
begin
  select id into v_user_id from auth.users where email = 'ci-e2e@kua.test';

  if v_user_id is null then
    v_user_id := gen_random_uuid();

    insert into auth.users (
      id, instance_id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      v_user_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'ci-e2e@kua.test',
      crypt('ci-e2e-Password123!', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      now(), now()
    );

    -- GoTrue password login requires a matching email identity row.
    insert into auth.identities (
      id, user_id, provider_id, provider, identity_data,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_user_id, v_user_id::text, 'email',
      jsonb_build_object(
        'sub', v_user_id::text,
        'email', 'ci-e2e@kua.test',
        'email_verified', true
      ),
      now(), now(), now()
    );
  end if;

  -- Link to the Axum seed shop as a confirmed owner (DEPLOY.md recipe).
  select id into v_shop_id from public.shops where alias = 'axum';
  if v_shop_id is not null
     and not exists (
       select 1 from public.shop_members
       where shop_id = v_shop_id and user_id = v_user_id
     ) then
    insert into public.shop_members (shop_id, user_id, role, status)
    values (v_shop_id, v_user_id, 'owner', 'confirmed');
  end if;
end $$;
