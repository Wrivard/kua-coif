-- Phase 63 — Reviews / ratings.
--
-- Client-side ratings on completed appointments. V1: admin can read
-- + moderate (publish / reject / delete) entries. V1.1: post-appointment
-- email link drives public submission with a signed token.

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  barber_id uuid references public.barbers(id) on delete set null,

  rating integer not null check (rating between 1 and 5),
  comment text,
  status text not null default 'pending'
    check (status in ('pending', 'published', 'rejected')),
  client_name text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create index reviews_shop_status_idx
  on public.reviews (shop_id, status, created_at desc);

create index reviews_barber_status_idx
  on public.reviews (barber_id, status)
  where status = 'published';

create trigger reviews_set_updated_at
  before update on public.reviews
  for each row execute function public.tg_set_updated_at();

alter table public.reviews enable row level security;

create policy reviews_select on public.reviews for select to authenticated
  using (shop_id in (
    select shop_id from public.shop_members
    where user_id = auth.uid() and status = 'confirmed'
  ));

create policy reviews_update on public.reviews for update to authenticated
  using (shop_id in (
    select shop_id from public.shop_members
    where user_id = auth.uid() and status = 'confirmed'
  ))
  with check (shop_id in (
    select shop_id from public.shop_members
    where user_id = auth.uid() and status = 'confirmed'
  ));

create policy reviews_delete on public.reviews for delete to authenticated
  using (shop_id in (
    select shop_id from public.shop_members
    where user_id = auth.uid() and status = 'confirmed'
  ));

-- Public SELECT on published reviews (anyone can read a salon's
-- published reviews — surfaces on the public /book page in V1.1).
create policy reviews_public_published on public.reviews for select to anon
  using (status = 'published');

comment on table public.reviews is
  'Phase 63 — Client reviews/ratings. Public submission flow ships via signed link in confirmation email (V1.1). Admin moderates by setting status=published.';
