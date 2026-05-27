-- Loop 52 (P99 follow-up from AUDIT_PHASE70) — per-client
-- QuickBooks Customer mapping.
--
-- Loop 49 shipped Phase 99 SalesReceipt creation with a V1 trade-
-- off: all receipts routed through a single "Walk-in" customer per
-- shop. This migration adds the column the find-or-create-per-
-- client flow needs to cache its lookups.
--
-- `clients.quickbooks_customer_id`:
--   * Set on first sync after the client's first completed
--     appointment via the shop's QB connection.
--   * The sync helper checks this column BEFORE calling Intuit's
--     query endpoint — caching saves ~200ms per receipt on subsequent
--     completions for the same client.
--   * Null is fine: clients who haven't been synced yet, or
--     shops that aren't QB-connected, never write to the column.
--
-- Note: we do NOT store the QB customer's display name or email
-- here. Intuit's customer record is the source of truth for those;
-- a future "edit customer in QB" workflow wouldn't need to
-- duplicate-update both rows.
--
-- Idempotent.

alter table public.clients
  add column if not exists quickbooks_customer_id text;

comment on column public.clients.quickbooks_customer_id is
  'Intuit-side QB Customer ID cached after first SalesReceipt sync. Saves ~200ms vs a fresh query on every subsequent receipt for this client.';

-- Lookup pattern is `WHERE id = $1 SELECT quickbooks_customer_id`,
-- which the existing PK index already satisfies — no new index
-- needed.
