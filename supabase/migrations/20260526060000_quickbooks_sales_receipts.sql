-- Loop 49 (Phase 99 from AUDIT_PHASE70) — QuickBooks SalesReceipt
-- creation on appointment completion.
--
-- Two new columns:
--   * appointments.quickbooks_sales_receipt_id (text) — Intuit-side
--     ID of the SalesReceipt we created for this appointment.
--     Doubles as the idempotency key: if the column is non-null,
--     the sync skips re-creation. Empty for appointments that
--     completed before QB was connected, or for shops that never
--     hooked up QB.
--
--   * shops.quickbooks_default_customer_id (text) — Cached
--     "Walk-in" customer ID we create once on first sync per
--     shop. V1 routes every SalesReceipt under this customer rather
--     than mapping per-appointment to a real QB customer (the
--     per-client mapping needs a customers table column + a
--     find-or-create flow with collision handling — deferred to
--     V1.1). Owner sees all receipts under one customer but can
--     manually re-assign in QB if they care; the line items still
--     carry the appointment date + service detail.
--
-- Idempotent.

alter table public.appointments
  add column if not exists quickbooks_sales_receipt_id text;

alter table public.shops
  add column if not exists quickbooks_default_customer_id text;

comment on column public.appointments.quickbooks_sales_receipt_id is
  'Intuit-side ID of the SalesReceipt we synced for this appointment. Non-null = already synced; the sync helper skips re-creation.';

comment on column public.shops.quickbooks_default_customer_id is
  'Cached QB Customer ID for the shop''s "Walk-in" customer, created once on first SalesReceipt sync. V1 routes every receipt through it; V1.1 will per-appointment customer matching.';

-- Partial index — the QB cron and dashboard "synced/unsynced"
-- panels need to count un-synced completed appointments quickly.
-- Index only the unsynced rows so the index stays small as history
-- grows.
create index if not exists appointments_qb_unsynced_idx
  on public.appointments (shop_id, start_at)
  where status = 'completed'
    and quickbooks_sales_receipt_id is null;
