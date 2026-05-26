-- Loop 46 (Phase 98 from AUDIT_PHASE70) — QuickBooks token timestamps.
--
-- Intuit's refresh tokens expire after 100 days of INACTIVITY. The
-- only way to keep a connected shop active without re-OAuth is to
-- periodically refresh — which itself resets the 100-day clock.
--
-- Two new columns:
--   * quickbooks_refresh_token_expires_at — when does the CURRENT
--     refresh token go invalid? Set on connect + on every refresh.
--   * quickbooks_last_refreshed_at — when did we last successfully
--     refresh (or initially set) the token? Drives the "Last
--     refreshed N ago" line in the settings status panel.
--
-- A daily cron (`/api/cron/quickbooks-refresh`) finds shops whose
-- refresh token is within 14 days of expiring and refreshes
-- proactively. 14-day window absorbs at least one cron miss (Vercel
-- cron isn't strict-SLA) without losing the connection.
--
-- Idempotent.

alter table public.shops
  add column if not exists quickbooks_refresh_token_expires_at timestamptz,
  add column if not exists quickbooks_last_refreshed_at timestamptz;

comment on column public.shops.quickbooks_refresh_token_expires_at is
  'When the current QuickBooks refresh token expires (≈100 days after last refresh). Cron uses this to schedule proactive refreshes.';
comment on column public.shops.quickbooks_last_refreshed_at is
  'When we last successfully refreshed (or initially obtained) the QB refresh token. Drives the settings status panel countdown.';

-- Partial index makes the cron's "expiring soon" filter fast even
-- as the shops table grows. WHERE clause keeps the index narrow.
create index if not exists shops_qb_refresh_expiring_idx
  on public.shops (quickbooks_refresh_token_expires_at)
  where quickbooks_connect_status = 'active'
    and quickbooks_refresh_token_expires_at is not null;
