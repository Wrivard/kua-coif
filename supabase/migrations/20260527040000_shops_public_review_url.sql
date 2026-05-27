-- Loop 58 — Marketing: shop's public review URL for QR code generation.
--
-- Each shop has a "review URL" they want customers to land on — could
-- be their Google Business Profile review link, Yelp page, in-app
-- /review/[token] flow, or anything else. The /marketing/reviews-qr
-- page generates a printable QR code pointing to whatever URL the
-- owner saves here.
--
-- Nullable: not all shops will set this immediately. When null, the
-- QR-code page shows a placeholder + setup prompt.
--
-- Not a credential, not encrypted. Plain public URL — same surface
-- as `shops.website` and `shops.yelp_id`.

alter table public.shops
  add column if not exists public_review_url text;

comment on column public.shops.public_review_url is
  'Public URL the QR code on /marketing/reviews-qr points to. Owner pastes their Google Business / Yelp / Instagram / in-app review page here. Null = QR code not generated yet.';
