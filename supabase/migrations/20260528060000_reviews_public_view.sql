-- Security audit #6 (MINOR) — restrict public review columns.
--
-- Pre-fix policy: `for select to anon using (status = 'published')`
-- exposes EVERY column to anonymous scrapers, including `client_id`,
-- `appointment_id`, and `barber_id`. A scraper hitting
-- /rest/v1/reviews?status=eq.published enumerates client UUIDs, which
-- can be cross-referenced with the /me/[token] flow's resourceId or
-- used as a pure enumeration oracle.
--
-- Fix: drop the column-level public SELECT and replace with a VIEW
-- that exposes only the columns the public booking page actually
-- needs (id, shop_id, rating, comment, client_name, created_at,
-- published_at). The underlying table stays fully RLS'd; anon can
-- only read via the view, and shop members read via the existing
-- shop-membership policy.

drop policy if exists reviews_public_published on public.reviews;

create or replace view public.reviews_public as
  select
    id,
    shop_id,
    rating,
    comment,
    client_name,
    created_at,
    published_at
  from public.reviews
  where status = 'published';

-- Grant SELECT on the view to anon. Views inherit the security
-- context of their owner (postgres → bypasses RLS on the underlying
-- table), so we need to grant explicitly. `security_invoker` would
-- re-apply RLS, but we WANT to bypass for the public columns subset.
grant select on public.reviews_public to anon, authenticated;

comment on view public.reviews_public is
  'Phase H security #6 — public-safe view of published reviews. The underlying reviews table no longer has an anon-SELECT policy; scrapers can only read this column subset, which excludes client_id, appointment_id, barber_id.';
