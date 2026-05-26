-- Phase 64 — Marketing banner on the public booking page.
--
-- A per-shop short promotional message rendered above the booking
-- wizard when the toggle is on. Keeps the shop owner in control of
-- their booking-page messaging without us needing a CMS.

alter table public.shops
  add column marketing_banner_text text,
  add column marketing_banner_enabled boolean not null default false;

comment on column public.shops.marketing_banner_text is
  'Phase 64 — promotional message shown above the public booking wizard when marketing_banner_enabled = true. Plain text, max 280 chars enforced by the admin form.';
comment on column public.shops.marketing_banner_enabled is
  'Phase 64 — toggle for the public booking-page banner.';
