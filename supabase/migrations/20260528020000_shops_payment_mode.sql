-- Phase D — per-shop payment mode toggle.
--
-- The user's product decision for V1:
--   - 'full'    → customer pays the full service price upfront in
--                 the booking widget; nothing left to pay at the shop.
--   - 'deposit' → customer pays each service's `deposit_amount_cents`
--                 upfront; balance collected at the shop. THIS IS
--                 THE CURRENT BEHAVIOR — default for existing rows.
--   - 'none'    → no online payment; the widget skips the
--                 PaymentElement step entirely. Owner collects in-
--                 person.
--
-- A shop with `payment_mode='deposit'` but every service's
-- `deposit_amount_cents=0` effectively behaves like 'none' today —
-- the booking action returns `kind: 'no_deposit'` and the wizard
-- skips payment. Switching to explicit 'none' mode is a clearer
-- statement of intent.
--
-- Promo codes (Phase D.3 follow-up) will reduce the charged amount
-- against this mode-derived total rather than the in-shop balance.

alter table public.shops
  add column if not exists payment_mode text not null default 'deposit'
    check (payment_mode in ('full', 'deposit', 'none'));

comment on column public.shops.payment_mode is
  'Phase D — controls what the booking widget collects up front. ''full''=entire service price, ''deposit''=per-service deposit_amount_cents (default for existing shops), ''none''=collect in-shop only.';
