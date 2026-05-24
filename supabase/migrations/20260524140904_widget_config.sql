-- =============================================================================
-- 20260524140904_widget_config.sql
-- Phase 10 — Embeddable booking widget.
--
-- Adds a per-shop `widget_config` jsonb column so admins can customize the
-- embedded booking widget without touching code: theme, accent, steps shown,
-- allowed iframe origins (for CSP frame-ancestors whitelisting), etc.
--
-- The shape lives in `lib/business/widget-config.ts` as a Zod schema; we keep
-- the DB column loose (`jsonb`) so adding new fields is a code-only change.
-- =============================================================================

alter table public.shops
  add column if not exists widget_config jsonb not null default '{}'::jsonb;

-- Public can read widget_config when fetching the shop for /book or /embed.
-- Anon already has no SELECT policy on shops (RLS forces only members) — the
-- public booking flow goes through the service-role client which bypasses RLS.
-- So no new policy needed; just make sure the column is part of the row.

comment on column public.shops.widget_config is
  'Per-shop widget customization (theme, steps, allowed origins). Parsed by lib/business/widget-config.ts.';
