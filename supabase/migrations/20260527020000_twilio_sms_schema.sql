-- Loop 53 (P100 slice 1 from AUDIT_PHASE70) — Twilio SMS schema.
--
-- Sets up the storage + per-shop config the SMS pipeline needs.
-- The cron dispatcher + delivery-status webhook ship in Loops
-- 54-55 as separate slices.
--
-- Two surfaces:
--
-- 1. `notification_sends` — extend the existing email-only idempotency
--    ledger to also track SMS sends. The kind enum stays as-is
--    (shape of the event: confirmation, reminder, etc.); we add a
--    `channel` column for the orthogonal email vs sms axis. The
--    UNIQUE constraint widens to (appointment_id, kind, channel) so
--    a single appointment can have BOTH an email AND an SMS send
--    of the same kind without duplicate-violation.
--
--    `provider_message_id` (Twilio's MessageSid) lets the future
--    status webhook map a delivery callback back to our row.
--
--    `status` is updated by that webhook; null = pending /
--    unknown, 'delivered' / 'failed' / 'undelivered' once Twilio
--    calls back.
--
-- 2. `shops` Twilio columns — per-shop credentials so each salon
--    uses ITS OWN Twilio account (the platform doesn't run a shared
--    Twilio number; that would create cross-shop spam exposure and
--    is contrary to A2P 10DLC registration rules). Auth token is
--    encrypted via the same NOTIFICATION_ENCRYPTION_KEY used for
--    SMTP + Google refresh tokens.
--
-- Idempotent.

-- ── Part 1 — notification_sends extension ──────────────────────────
alter table public.notification_sends
  add column if not exists channel text not null default 'email'
    check (channel in ('email', 'sms')),
  add column if not exists provider_message_id text,
  add column if not exists status text;

comment on column public.notification_sends.channel is
  'Transport channel. ''email'' for the existing dispatcher, ''sms'' for the Twilio path (Loop 53+).';
comment on column public.notification_sends.provider_message_id is
  'Twilio MessageSid (SMS) or Resend message id (email). Lets the status webhook map callbacks back to this row.';
comment on column public.notification_sends.status is
  'Delivery status updated by the provider webhook. Null = unsent or unknown; ''sent'', ''delivered'', ''failed'', ''undelivered'' once we hear back.';

-- The original UNIQUE was (appointment_id, kind). Widen to include
-- `channel` so a single appointment can carry both an email and an
-- SMS reminder_24h row without collision. We DROP the old
-- constraint first because Postgres rejects a SECOND UNIQUE that
-- overlaps a strict subset of columns.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'notification_sends_appointment_id_kind_key'
      and conrelid = 'public.notification_sends'::regclass
  ) then
    alter table public.notification_sends
      drop constraint notification_sends_appointment_id_kind_key;
  end if;
end$$;

create unique index if not exists notification_sends_appt_kind_channel_uniq
  on public.notification_sends (appointment_id, kind, channel);

-- ── Part 2 — shops Twilio columns ──────────────────────────────────
alter table public.shops
  add column if not exists twilio_account_sid text,
  add column if not exists twilio_auth_token_enc text,
  add column if not exists twilio_from_number text;

comment on column public.shops.twilio_account_sid is
  'Twilio Account SID for outbound SMS. Pairs with twilio_auth_token_enc and twilio_from_number; all three must be set for the SMS dispatcher to consider the shop configured.';
comment on column public.shops.twilio_auth_token_enc is
  'Encrypted Twilio auth token (via NOTIFICATION_ENCRYPTION_KEY). REVOKE''d from authenticated/anon — service-role only.';
comment on column public.shops.twilio_from_number is
  'E.164 phone number Twilio sends FROM. Must be a number purchased / verified on the shop''s own Twilio account.';

-- Same column-level REVOKE pattern as SMTP password + QB refresh.
revoke select (twilio_auth_token_enc) on public.shops from authenticated, anon;
