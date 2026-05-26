-- Phase 62 — Per-shop email branding.
--
-- Two optional fields on shops. When set, the transactional email
-- pipeline (`lib/email/send.ts` + templates) substitutes them for the
-- platform defaults so the confirmation / reminder / cancellation
-- emails feel like they come from THIS salon, not from Küa.

alter table public.shops
  add column email_logo_url text,
  add column email_accent_color text check (
    email_accent_color is null
    or email_accent_color ~ '^#[0-9a-fA-F]{6}$'
  );

comment on column public.shops.email_logo_url is
  'Phase 62 — optional logo URL for the shop''s branded transactional emails (confirmation, reminder). Falls back to platform default when null.';
comment on column public.shops.email_accent_color is
  'Phase 62 — optional hex accent color (e.g. #8b5cf6) used for buttons + headers in transactional emails. Constrained to #rrggbb format.';
