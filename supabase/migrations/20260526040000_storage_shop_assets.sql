-- Loop 43 (Phase 120 from AUDIT_PHASE70) — Storage bucket for shop
-- assets (logos in V1, barber avatars + service photos in V1.5).
--
-- Why public read: the logo URL ends up in transactional emails sent
-- to customers + on the public booking page. Customers don't have a
-- Supabase session, so the asset must be world-readable. We never
-- store anything sensitive in this bucket — the RLS write policy
-- below is what protects against another shop overwriting your logo.
--
-- Path convention: `shops/<shop_id>/<purpose>/<filename>` so the
-- prefix-match policy can scope writes to the caller's own shop_id.
-- `purpose` is one of: `logo`, `avatars`, `services` (V1.5).
--
-- File-size cap (5 MB) is set at the bucket level; the upload server
-- action enforces a tighter 2 MB cap before forwarding to Storage to
-- save bandwidth on rejected uploads.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'shop-assets',
  'shop-assets',
  true,
  5 * 1024 * 1024,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public read — needed for unauthenticated customers viewing the
-- booking page + reading email logos. Storage's RLS uses string LIKE
-- on the bucket name (storage.objects.bucket_id).
drop policy if exists "shop-assets read" on storage.objects;
create policy "shop-assets read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'shop-assets');

-- Shop members write — the path's second segment must match a
-- shop_id the user is a confirmed member of. `storage.foldername` is
-- a Supabase helper returning the path segments as a text[]. The
-- first segment is conventionally `shops`, the second is the UUID.
drop policy if exists "shop-assets shop-member write" on storage.objects;
create policy "shop-assets shop-member write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'shop-assets'
    and (storage.foldername(name))[1] = 'shops'
    and (storage.foldername(name))[2]::uuid in (
      select shop_id from public.shop_members
      where user_id = auth.uid() and status = 'confirmed'
    )
  );

-- Same prefix gate for updates + deletes so a shop can replace its
-- own logo or remove an old avatar.
drop policy if exists "shop-assets shop-member update" on storage.objects;
create policy "shop-assets shop-member update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'shop-assets'
    and (storage.foldername(name))[1] = 'shops'
    and (storage.foldername(name))[2]::uuid in (
      select shop_id from public.shop_members
      where user_id = auth.uid() and status = 'confirmed'
    )
  );

drop policy if exists "shop-assets shop-member delete" on storage.objects;
create policy "shop-assets shop-member delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'shop-assets'
    and (storage.foldername(name))[1] = 'shops'
    and (storage.foldername(name))[2]::uuid in (
      select shop_id from public.shop_members
      where user_id = auth.uid() and status = 'confirmed'
    )
  );
