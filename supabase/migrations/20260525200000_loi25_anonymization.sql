-- =============================================================================
-- 20260525200000_loi25_anonymization.sql
-- Phase 40 — Loi 25 (Quebec privacy law) anonymization support.
--
-- The deletion model we use: anonymize rather than hard-delete.
--
-- Why: Revenu Québec requires fiscal records (every sale, every tip,
-- every appointment that generated revenue) to be retained for 6 years.
-- Hard-deleting a client would break appointment_services / payment
-- joins and corrupt the shop's bookkeeping.
--
-- Anonymization model:
--   - On request, the `clients` row gets `anonymized_at = now()`.
--   - first_name / last_name / email / phone / notes get overwritten
--     with placeholders by the Server Action (`deleteClientPersonalData`).
--   - Appointments remain (the shop still sees "an appointment happened")
--     but the client_name in their join renders as "[Anonymized]".
--   - When the 6-year retention expires the row can be HARD-deleted by
--     a future cron / admin job.
-- =============================================================================

alter table public.clients
  add column if not exists anonymized_at timestamptz;

create index if not exists clients_anonymized_idx
  on public.clients (anonymized_at)
  where anonymized_at is not null;

comment on column public.clients.anonymized_at is
  'Loi 25 anonymization timestamp. When set, the PII columns (first_name, last_name, email, phone, notes) hold placeholder values. The row itself stays for fiscal retention (6 years).';
