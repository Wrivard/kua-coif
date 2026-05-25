-- =============================================================================
-- 20260525112136_notification_automations.sql
-- Phase 25 — Per-shop notification automations + SMTP-per-shop config.
--
-- Two related additions:
--
--   1. `shops.notification_*` columns hold the shop's own SMTP credentials
--      so emails can ship from `noreply@<their-domain>` instead of our
--      Resend default. The SMTP password is stored **encrypted** (AES-256
--      app-side, see `lib/crypto/aes.ts`) — column-level UPDATE is still
--      gated by the existing `shops_update_member` policy so only managers+
--      of the shop can change it. The encrypted-at-rest column never leaves
--      the server (no SELECT path for clients), so a leaked publishable key
--      can't read it.
--
--   2. `notification_automations` declares which automations the shop has
--      enabled (booking_confirmation, reminder_24h, etc.) per channel
--      (email / sms). One row per (shop_id, kind, channel) combo. Defaults
--      are seeded for every existing shop AND for every new shop (handled
--      by the create-shop Server Action, not a trigger — keeps the DB
--      simple).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Sender config on shops
-- -----------------------------------------------------------------------------
alter table public.shops
  add column if not exists notification_from_email      text,
  add column if not exists notification_from_name       text,
  add column if not exists notification_smtp_host       text,
  add column if not exists notification_smtp_port       integer,
  add column if not exists notification_smtp_user       text,
  add column if not exists notification_smtp_password_enc text;

comment on column public.shops.notification_smtp_password_enc is
  'AES-256-GCM ciphertext of the SMTP password. Decrypt via lib/crypto/aes.ts using the NOTIFICATION_ENCRYPTION_KEY env var. Never returned to the client.';

-- Belt-and-braces: prevent anon and authenticated REST clients from reading
-- the encrypted column. Even though it's ciphertext, leaking it would give
-- an attacker something to brute-force offline.
revoke select (notification_smtp_password_enc) on public.shops from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. notification_automations table
-- -----------------------------------------------------------------------------
create table if not exists public.notification_automations (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id) on delete cascade,
  kind        text not null check (kind in (
    'booking_confirmation',
    'reminder_24h',
    'reminder_1h',
    'cancellation',
    'birthday'
  )),
  channel     text not null default 'email' check (channel in ('email','sms')),
  enabled     boolean not null default false,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (shop_id, kind, channel)
);

create index if not exists notification_automations_shop_idx
  on public.notification_automations (shop_id);

-- RLS — same shape as the rest of the shop-scoped tables.
alter table public.notification_automations enable row level security;
alter table public.notification_automations force row level security;

drop policy if exists notification_automations_select on public.notification_automations;
create policy notification_automations_select on public.notification_automations
  for select to authenticated
  using (is_shop_member(shop_id));

drop policy if exists notification_automations_rw on public.notification_automations;
create policy notification_automations_rw on public.notification_automations
  for all to authenticated
  using (has_role_in_shop(shop_id, 'manager'::user_role))
  with check (has_role_in_shop(shop_id, 'manager'::user_role));

-- Touch updated_at on every UPDATE — reuses the project-wide trigger.
drop trigger if exists set_updated_at on public.notification_automations;
create trigger set_updated_at
  before update on public.notification_automations
  for each row execute procedure public.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. Seed defaults for every existing shop
-- -----------------------------------------------------------------------------
-- New shops get their rows from the `createShopAction` (Phase 22 / Phase 23
-- code), keeping defaults in TS where they're easier to evolve. For shops
-- created BEFORE Phase 25, we backfill here so the UI doesn't show a half-
-- empty list.
--
-- Defaults match what `/settings/notifications` will display:
--   - booking_confirmation email: ON   (was already firing in Phase 24)
--   - cancellation         email: ON
--   - reminder_24h         email: OFF  (requires shop SMTP, opt-in)
--   - reminder_1h          email: OFF  (can be annoying, opt-in)
--   - birthday             email: OFF  (V1.5)
--   - every kind + sms channel: OFF    (no provider wired yet)
insert into public.notification_automations (shop_id, kind, channel, enabled)
select s.id, k.kind, k.channel, k.enabled
from public.shops s
cross join (values
  ('booking_confirmation', 'email',  true),
  ('reminder_24h',         'email',  false),
  ('reminder_1h',          'email',  false),
  ('cancellation',         'email',  true),
  ('birthday',             'email',  false),
  ('booking_confirmation', 'sms',    false),
  ('reminder_24h',         'sms',    false),
  ('reminder_1h',          'sms',    false),
  ('cancellation',         'sms',    false),
  ('birthday',             'sms',    false)
) as k(kind, channel, enabled)
on conflict (shop_id, kind, channel) do nothing;
