# Plan 014: Single-source the booking price formula + parity tests (PI mint vs booking verify)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- "app/[locale]/book/[shopSlug]/actions.ts" lib/business`
> Plan 001 legitimately changed this file (refund-on-failure) — expected drift;
> compare the PRICING excerpts below against live code and STOP on mismatch there.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (money math — mitigated by extract-then-delegate: the new pure
  function must produce BYTE-IDENTICAL results before the call sites switch)
- **Depends on**: plan 001 (same file — land first)
- **Category**: tests / tech-debt
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

The charge amount is computed **twice**, in two hand-maintained copies that
must stay byte-identical: `createBookingPaymentIntent` computes what Stripe
charges (mint), and `bookPublicAppointment` recomputes what the PI *should*
be (verify) — the code's own comment warns "Any drift between the two
formulas → verify rejects a legit PI", i.e. a one-cent divergence is a
**total public-booking outage** (every paid booking rejected). This is the
single highest-churn money file in the repo (9 commits in 4 days) and the
formula has zero tests. Extract ONE pure function consumed by both sites, and
pin it with unit + parity tests so drift becomes a failing test instead of an
outage.

## Current state

Both in `app/[locale]/book/[shopSlug]/actions.ts` (at `ef34cee`):

- **Verify side** (`bookPublicAppointment`):
  - promo applied into `totalAmount` earlier (validation incl.
    `first_appointment_only` at :557-566 — POLICY stays in the action);
  - loyalty (:546-550):

```ts
if (clientLoyaltyBalanceCents > 0 && totalAmount > 0) {
  const runningCents = Math.round(totalAmount * 100);
  loyaltyCreditCents = Math.min(clientLoyaltyBalanceCents, runningCents);
  totalAmount = Math.max(0, totalAmount - loyaltyCreditCents / 100);
}
```

  - recompute (:611-617):

```ts
const tipCentsForVerify = Math.max(0, Math.min(100_000, input.tip_amount_cents ?? 0));
const recomputedDepositCents = input.payment_intent_id
  ? (shop.payment_mode === 'full'
      ? Math.round(totalAmount * 100)
      : services.reduce((sum, s) => sum + Number(s.deposit_amount_cents ?? 0), 0)) +
    tipCentsForVerify
  : 0;
```

- **Mint side** (`createBookingPaymentIntent`, 'full' branch :1352-1412):
  `subtotalDollars = Σ price` → promo (percent: `subtotal*value/100`; fixed:
  `value`; capped at subtotal; invalid/expired/one_time-used promos **degrade
  silently to no discount** — :1368-1376) → loyalty by `phone_normalized`
  last-10 with the same cents cap (:1404-1408) →
  `depositCents = Math.round(totalDollars * 100)`. 'deposit' branch (:1414):
  `Σ deposit_amount_cents`. Tip stacks after, both modes (:1417+).
- Pure-engine convention to match: `lib/business/taxes.ts` +
  `lib/business/taxes.test.ts` (typed inputs, no I/O, exhaustive cases).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| New tests | `pnpm vitest run lib/business/booking-pricing.test.ts` | all pass |
| Full suite | `pnpm test` | all pass |
| Lint/format | `pnpm lint` && `pnpm format:check` | exit 0 |

## Scope

**In scope**:
- NEW `lib/business/booking-pricing.ts` + `lib/business/booking-pricing.test.ts`
- `app/[locale]/book/[shopSlug]/actions.ts` — ONLY the formula lines listed
  above are replaced by calls; promo VALIDATION, loyalty FETCHING, Stripe
  calls, inserts stay untouched.

**Out of scope**:
- Any behavioral change to pricing (this is an extraction — outputs must be
  identical, including the float-dollar intermediate representation; do NOT
  "fix" the dollars-float math here even if cents-everywhere would be better —
  record it as a maintenance note).
- The wizard, the slots route, taxes/tips engines.

## Git workflow

- Conventional commit: `refactor(booking): single-source the charge formula + parity tests`.
- Do NOT push unless instructed.

## Steps

### Step 1: Write the pure function (no call-site change yet)

`lib/business/booking-pricing.ts`:

```ts
export type BookingPricingInput = {
  paymentMode: 'full' | 'deposit' | 'none';
  services: Array<{ price: number; deposit_amount_cents: number | null }>;
  /** RESOLVED promo (caller validates policy/eligibility) or null. */
  promo: { type: 'percent' | 'fixed'; value: number } | null;
  /** Effective (non-expired) loyalty balance in cents; 0 when none. */
  loyaltyBalanceCents: number;
  tipAmountCents: number | null | undefined;
};
export type BookingPricing = {
  subtotalDollars: number;
  discountDollars: number;
  loyaltyCreditCents: number;
  /** Post-promo, post-loyalty service total in dollars (row's total_amount). */
  totalDollars: number;
  tipCents: number; // clamped 0..100_000
  /** What the PI must charge: base per mode + tip. 0 when mode==='none'. */
  chargeCents: number;
};
export function computeBookingPricing(input: BookingPricingInput): BookingPricing { ... }
```

Implement EXACTLY the existing math, in this order: subtotal (Σ
`Number(price ?? 0)`) → discount (percent `subtotal*value/100`, fixed `value`,
`Math.min(raw, subtotal)`) → `totalDollars = subtotal - discount` → loyalty
(`runningCents = Math.round(totalDollars*100)`; `credit = Math.min(balance,
runningCents)`; `totalDollars = Math.max(0, totalDollars - credit/100)`;
credit applied only when `balance > 0 && totalDollars > 0`) → tip clamp →
`chargeCents`: `none` → 0; `full` → `Math.round(totalDollars*100) + tipCents`;
`deposit` → `Σ Number(deposit_amount_cents ?? 0) + tipCents`.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Unit + parity tests FIRST, against the spec above

`lib/business/booking-pricing.test.ts`, modeled on
`lib/business/taxes.test.ts`. Cases (minimum):
- full/no promo/no loyalty/no tip; full + percent promo; full + fixed promo
  > subtotal (capped); full + loyalty smaller than total; loyalty LARGER than
  total (total floors at 0, credit = runningCents); promo + loyalty stacking
  order (promo first); deposit mode ignores promo/loyalty;
  tip clamps at 100_000 and at 0 (negative input); mode none → chargeCents 0
  even with tip (matches :617's `: 0` branch); float-sensitive case
  (e.g. three services at 19.99 + 15% promo) asserting exact cents.
- PARITY characterization: for 5 representative inputs, hand-compute the
  CURRENT inline formulas' results (copy the old expressions into the test as
  local reference implementations) and assert `computeBookingPricing` matches
  them — this is the proof the extraction is faithful.

**Verify**: `pnpm vitest run lib/business/booking-pricing.test.ts` → all pass.

### Step 3: Switch `createBookingPaymentIntent`

Replace the 'full'-branch math (:1352-1412's arithmetic — KEEP the promo
fetch/eligibility checks and the loyalty fetch exactly as they are) so the
fetched inputs feed `computeBookingPricing(...)` and `depositCents =
result.chargeCents - 0` per mode (tip handling included — delete the now-dead
local tip stacking). The promo silent-degrade policy stays in THIS caller
(invalid promo ⇒ `promo: null`).

**Verify**: `pnpm typecheck` → exit 0; `pnpm test` → all pass.

### Step 4: Switch `bookPublicAppointment`

Same delegation on the verify side: the action keeps its validation
(first_appointment_only etc.) and fetches, then calls the SAME function and
uses `result.totalDollars` for `total_amount`, `result.loyaltyCreditCents`
for the debit, `result.chargeCents` for `recomputedDepositCents`. Delete the
inline copies (:546-550, :611-617's arithmetic).

**Verify**: `pnpm typecheck`; `pnpm test`; grep gates:
`grep -n "Math.min(100_000" "app/[locale]/book/[shopSlug]/actions.ts"` → 0
matches (clamp now lives in the engine);
`grep -c "computeBookingPricing" "app/[locale]/book/[shopSlug]/actions.ts"` → 2.

### Step 5: Full gates

**Verify**: `pnpm test` → all pass; `pnpm lint` && `pnpm format:check` &&
`pnpm build` → exit 0.

## Test plan

Steps 2's cases are the deliverable (≥ 12 cases incl. 5 parity
characterizations). Plan 015 then exercises the two CALLERS end-to-end.

## Done criteria

- [ ] `lib/business/booking-pricing.ts` exists, pure (no supabase/stripe imports)
- [ ] ≥ 12 tests pass; parity characterizations included
- [ ] Both call sites delegate (grep = 2); inline formula deleted
- [ ] `pnpm typecheck`, `pnpm test`, lint, format, build all exit 0
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Live code's formulas differ from the excerpts (plan 001 only added refund
  calls — it must NOT have changed arithmetic; if it did, re-characterize
  before extracting).
- A parity test disagrees with your reference implementation — do NOT "pick
  one"; report the divergence (it may be a REAL latent mint/verify drift).
- You're tempted to convert dollars→cents representation throughout — out of
  scope (note below).

## Maintenance notes

- The float-dollar intermediate (`totalDollars`) is preserved by design to
  avoid a behavior change; migrating the whole pipeline to integer cents is
  the right V2 — do it behind these tests.
- Any future pricing input (gift cards, memberships, packages) goes into
  `computeBookingPricing` — never inline in an action again.
- Reviewer: confirm the promo POLICY checks (expiry/one-time/first-only) did
  not move — only arithmetic moved.
