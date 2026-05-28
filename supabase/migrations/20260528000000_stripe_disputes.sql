-- Phase B (Stripe disputes + receipt loop) — track chargebacks
-- received against shop transactions.
--
-- Stripe fires `charge.dispute.created` when a customer's bank
-- initiates a chargeback. The shop has limited time (typically 7
-- days) to submit evidence before the dispute is auto-lost. Without
-- a record on our side, the first chargeback surprises the shop
-- owner who logs into the Stripe dashboard months later and finds
-- $200 missing.
--
-- Surfaces this migration enables:
--   - admin/disputes view (Phase B SR or Phase F follow-up)
--   - email + Slack alert to the shop owner on creation (Phase B)
--   - status timeline as the dispute progresses (warning → under
--     review → won/lost) via `charge.dispute.updated` webhooks
--
-- We store the appointment_id as nullable because:
--   - the dispute may predate any Küa appointment (e.g. a refund
--     gone wrong on a manual charge)
--   - the appointment may have been hard-deleted by the time the
--     dispute lands (rare; Loi 25 anonymization keeps the row)
--
-- One dispute per (shop, stripe_dispute_id) — Stripe's dispute ID
-- is the natural primary key from their side.

create table if not exists public.disputes (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,

  stripe_dispute_id text not null,
  stripe_charge_id text not null,
  stripe_payment_intent_id text,

  -- Amount + currency captured at the time the dispute opened.
  -- Stripe quotes these in the same currency as the original
  -- charge (CAD for V1).
  amount_cents integer not null,
  currency text not null default 'cad',

  -- Stripe enum values:
  --   'duplicate', 'fraudulent', 'subscription_canceled',
  --   'product_unacceptable', 'product_not_received',
  --   'unrecognized', 'credit_not_processed',
  --   'general', 'incorrect_account_details',
  --   'insufficient_funds', 'bank_cannot_process',
  --   'debit_not_authorized', 'customer_initiated'
  reason text not null,

  -- Stripe enum values:
  --   'warning_needs_response', 'warning_under_review',
  --   'warning_closed', 'needs_response', 'under_review',
  --   'won', 'lost', 'charge_refunded'
  status text not null,

  -- When the shop must submit evidence by, or null if past the
  -- deadline / not applicable. Stripe quotes as Unix timestamp.
  evidence_due_by timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (stripe_dispute_id)
);

create index if not exists disputes_shop_idx
  on public.disputes (shop_id, created_at desc);

create index if not exists disputes_appointment_idx
  on public.disputes (appointment_id)
  where appointment_id is not null;

-- updated_at trigger — reuses the project-wide helper.
drop trigger if exists set_updated_at on public.disputes;
create trigger set_updated_at
  before update on public.disputes
  for each row execute procedure public.tg_set_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────
alter table public.disputes enable row level security;
alter table public.disputes force row level security;

-- Shop members can READ their shop's disputes (future admin/disputes
-- view). Writes are service-role only — only the Stripe webhook
-- handler creates / updates dispute rows.
drop policy if exists disputes_select on public.disputes;
create policy disputes_select on public.disputes
  for select to authenticated
  using (is_shop_member(shop_id));

comment on table public.disputes is
  'Phase B — chargeback / dispute records mirrored from Stripe webhooks. One row per (shop, stripe_dispute_id). Writes are service-role-only via /api/webhooks/stripe.';
