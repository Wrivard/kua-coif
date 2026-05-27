-- Loop 62 — Birthday automation + marketing-sends ledger.
--
-- Two surfaces in one migration because they ship together: the
-- birthday cron can't fire without a date_of_birth column, and its
-- idempotency lookup uses the client_marketing_sends table.
--
-- ── Part 1 — clients.date_of_birth ───────────────────────────────
-- Nullable because most existing rows won't have it; the booking
-- flow doesn't ask for it (privacy-first). Owners + clients can
-- fill it in via the clients edit form. Year stored so we can
-- compute age in the future ("congrats on your X birthday") if we
-- want — birthday matching uses (month, day) only.
alter table public.clients
  add column if not exists date_of_birth date;

comment on column public.clients.date_of_birth is
  'Optional. Used by the daily birthday-greetings cron to send a one-per-year birthday message via email + SMS. Match is on (month, day) ignoring year; year stored for future age-derived features.';

-- Partial index on (month, day) for the daily cron's window scan.
-- Excludes rows without a date_of_birth so the index stays small.
create index if not exists clients_birthday_md_idx
  on public.clients (
    extract(month from date_of_birth),
    extract(day from date_of_birth)
  )
  where date_of_birth is not null and anonymized_at is null;

-- ── Part 2 — client_marketing_sends ──────────────────────────────
-- The existing `notification_sends` table is keyed on appointment_id
-- and tracks reminder/confirmation/cancellation events tied to a
-- specific booking. Marketing sends (birthday, lapsed-client
-- winback, bulk review requests) are CLIENT-scoped, not
-- appointment-scoped — different shape, different lifecycle. A
-- separate ledger keeps the two semantics clean and avoids
-- polluting the appointment-centric table.
--
-- `recurrence_key` is the flexible idempotency knob:
--   - birthday: 'YYYY' (year) — guarantees one send per client per
--     year per channel, no matter how many times the cron runs.
--   - winback: 'YYYY-Qn' (year + quarter) or a campaign_id.
--   - review_request: appointment_id (one ask per appointment).
--   - custom bulk send: campaign_id.
--
-- Null `recurrence_key` means "no recurrence guard" — caller is
-- responsible for de-duplication. We expose it so future marketing
-- shapes can slot in without a schema change.

create table if not exists public.client_marketing_sends (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('birthday', 'winback', 'review_request', 'custom')),
  channel text not null check (channel in ('email', 'sms')),
  recurrence_key text,
  sent_at timestamptz not null default now(),
  via text not null,
  provider_message_id text,
  status text,
  unique (client_id, kind, channel, recurrence_key)
);

create index if not exists client_marketing_sends_shop_idx
  on public.client_marketing_sends (shop_id, sent_at desc);

-- RLS — same shape as the rest of the shop-scoped tables.
alter table public.client_marketing_sends enable row level security;
alter table public.client_marketing_sends force row level security;

drop policy if exists client_marketing_sends_select on public.client_marketing_sends;
create policy client_marketing_sends_select on public.client_marketing_sends
  for select to authenticated
  using (is_shop_member(shop_id));

-- Writes are service-role only — the cron + the bulk-campaign
-- dispatcher both use the service-role client to bypass RLS, so we
-- don't need an authenticated INSERT policy.

comment on table public.client_marketing_sends is
  'Loop 62 — ledger of marketing messages sent to clients (birthday greetings, lapsed-client winback, bulk review requests, custom campaigns). Separate from notification_sends because those are appointment-scoped. Idempotency via UNIQUE (client_id, kind, channel, recurrence_key).';
