-- ---------------------------------------------------------------------------
-- Revocable receipt / review / reschedule tokens (plan 013).
--
-- The receipt (365d), review (90d) and reschedule (7d) tokens are stateless
-- HMAC bearer credentials scoped to a single appointment — once issued they
-- stay valid until expiry with no way to revoke a specific appointment's links
-- (e.g. if a confirmation email was forwarded/leaked). This adds a
-- per-appointment version counter that those tokens embed (`ver`) and the
-- verify paths check against; bumping it invalidates every outstanding
-- receipt/review/reschedule link for that appointment.
--
-- Legacy tokens minted before this migration carry no `ver` and are treated as
-- version 0 by convention (absent ⇒ 0); the column defaults to 0 so nothing is
-- invalidated at deploy. Mirrors clients.me_token_version (W5c).
-- ---------------------------------------------------------------------------

alter table public.appointments
  add column if not exists public_link_version integer not null default 0;

comment on column public.appointments.public_link_version is
  'Revocation version embedded in receipt/review/reschedule signed tokens; bump to invalidate all outstanding links for this appointment.';
