# Plan 001: Refund the PaymentIntent when public booking fails after the card was charged

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- "app/[locale]/book/[shopSlug]/actions.ts" lib/stripe/payments.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (money path — a wrong refund condition could refund charges that should be kept, or refund a PI that belongs to another shop)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

The public booking wizard charges the customer's card **client-side, before the
server action runs**: `booking-wizard.tsx` calls
`paymentRef.current.confirmPayment()` (Stripe Elements — the PI becomes
`succeeded`/`processing`) and only then calls `bookPublicAppointment(...)`.
Inside the action, many rejection paths can fire *after* that charge: the
slot-race unique-violation (23505 → CONFLICT), the availability re-check, the
`first_appointment_only` promo rejection for returning customers, the
booking-interval grid check, and the multi-service check. Every one of them
returns an error **without refunding** — the customer paid, got no appointment,
and nothing reconciles the money (the 23505 path doesn't even capture the PI id
to Sentry). A two-customers-race on the last slot is a realistic everyday event.

## Current state

- `app/[locale]/book/[shopSlug]/actions.ts` — `bookPublicAppointment` (~line
  150–1000), the public booking money path. The Supabase client is
  **service-role** (`const supabase = createSupabaseServiceRoleClient() as any;`
  ~line 184). Imports from `@/lib/stripe/payments` today (~lines 19–23):
  `createDepositPaymentIntent` / `getReusableDepositPaymentIntent` /
  `verifyDepositPaymentIntent` — **no refund helper is imported**.
- `app/[locale]/book/[shopSlug]/booking-wizard.tsx:601-670` — `submit()`:
  `confirmPayment()` at :611 (charges the card), then `bookPublicAppointment`
  at :634; on `!result.ok` it only shows a toast (:666-668). **No client change
  is needed in this plan** — the fix is entirely server-side.
- `lib/stripe/payments.ts` — existing helpers you will reuse:
  - `refundPaymentIntentFull({ paymentIntentId })` (line ~217) — retrieves the
    PI then full-refunds with a deterministic idempotency key.
  - `verifyDepositPaymentIntent(...)` (line ~291) — checks, in order:
    exists → destination matches the shop (`wrong_shop`) → currency (`wrong_currency`)
    → amount (`wrong_amount`) → status `succeeded|processing` (`wrong_status`).
  - The destination-extraction idiom (string vs expanded object) at lines
    ~312-315 — copy it for the new helper.

Post-charge failure returns in `bookPublicAppointment` as of `ef34cee` (line
numbers from this commit; the drift check protects you):

| Site | Line(s) | Returns |
|---|---|---|
| multi-service disallowed | 432-434 | `err('INVALID_INPUT')` |
| off-grid interval check | 448-450 | `err('INVALID_INPUT')` |
| availability verdict | 474-480 | `err('CONFLICT' \| 'INVALID_INPUT')` |
| client insert failure | 536 | `err('UNEXPECTED')` |
| promo `first_only` for returning client | 564-566 | `err('INVALID_INPUT', { promo_code: 'first_only' })` |
| missing `shop.stripe_account_id` | 626 | `err('UNEXPECTED')` |
| PI verify failed | 633-641 | `err('UNEXPECTED')` |
| appointment insert 23505 (slot race) | 689-699 | `err('CONFLICT')` |
| appointment insert other error | 699 | `err('UNEXPECTED')` |
| appointment_services link failure (rollback) | 717-741 | `err('UNEXPECTED')` (already Sentry-captures the PI id) |

Conventions: Result pattern via `err()/ok()` from
`@/lib/server-actions/result`; Sentry via `captureException` from
`@/lib/observability` with `tags: { layer: 'public-booking', ... }` (see the
existing rollback capture at :725-738 — match it).

## Commands you will need

| Purpose   | Command          | Expected on success |
|-----------|------------------|---------------------|
| Typecheck | `pnpm typecheck` | exit 0              |
| Tests     | `pnpm test`      | all pass            |
| Lint      | `pnpm lint`      | exit 0              |
| Format    | `pnpm format:check` | exit 0 (run `pnpm format` to fix) |

## Scope

**In scope** (the only files you should modify):
- `lib/stripe/payments.ts` (add one helper)
- `app/[locale]/book/[shopSlug]/actions.ts` (route the post-charge failure
  returns through a refund-aware local helper)

**Out of scope** (do NOT touch, even though they look related):
- `app/[locale]/book/[shopSlug]/booking-wizard.tsx` — no client change needed.
- `app/api/webhooks/stripe/route.ts` — webhook semantics unchanged.
- `app/[locale]/reschedule/[token]/actions.ts` — the public reschedule has no
  payment leg; its `formatMinutes` twin is handled by the bound check here only
  for the booking action (see step 4 note).
- Switching to a manual-capture (authorize-then-capture) PI model — the correct
  long-term design, but a much bigger change; record in maintenance notes.

## Git workflow

- Branch: `advisor/001-booking-refund-on-failure` (or commit directly on main
  if the operator's workflow does that — match the repo: recent history commits
  to main).
- Conventional commit, e.g. `fix(booking): refund the charged PI when a public booking fails post-charge`.
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Add `refundOwnedIntentBestEffort` to `lib/stripe/payments.ts`

Add (near `refundPaymentIntentFull`) a helper that refunds **only a PI that
provably belongs to this shop and actually captured money**:

```ts
export async function refundOwnedIntentBestEffort({
  paymentIntentId,
  expectedConnectedAccountId,
}: {
  paymentIntentId: string;
  expectedConnectedAccountId: string;
}): Promise<{ refunded: boolean; reason?: string }> {
  const stripe = getStripe();
  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch {
    return { refunded: false, reason: 'not_found' };
  }
  const dest =
    typeof intent.transfer_data?.destination === 'string'
      ? intent.transfer_data.destination
      : (intent.transfer_data?.destination?.id ?? null);
  // NEVER refund a PI that isn't destined to THIS shop — a crafted POST could
  // otherwise weaponize the failure path to refund someone else's charge.
  if (dest !== expectedConnectedAccountId) return { refunded: false, reason: 'wrong_shop' };
  // Nothing captured yet → nothing to refund (requires_payment_method etc.).
  if (intent.status !== 'succeeded' && intent.status !== 'processing') {
    return { refunded: false, reason: 'not_charged' };
  }
  await refundPaymentIntent({ paymentIntentId, amountCents: intent.amount });
  return { refunded: true };
}
```

Note: `refundPaymentIntent` can throw (e.g. a `processing` charge not yet
refundable) — let it throw; the caller (step 2) catches and Sentry-captures.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Add a `failBooking` local helper in `bookPublicAppointment`

Inside the `try` block of `bookPublicAppointment`, **after** the shop row is
resolved (the helper needs `shop.stripe_account_id`), define:

```ts
// Any rejection AFTER the wizard charged the card must give the money back.
// Best-effort: a refund failure must not mask the original error — capture it.
const failBooking = async <T extends Parameters<typeof err>>(...args: T) => {
  if (input.payment_intent_id && shop.stripe_account_id) {
    try {
      const r = await refundOwnedIntentBestEffort({
        paymentIntentId: input.payment_intent_id,
        expectedConnectedAccountId: shop.stripe_account_id,
      });
      if (!r.refunded && r.reason !== 'wrong_shop' && r.reason !== 'not_charged') {
        captureException(new Error(`[booking] refund-on-failure skipped: ${r.reason}`), {
          tags: { layer: 'public-booking', step: 'refund-on-failure' },
          extra: { shopId: shop.id, paymentIntentId: input.payment_intent_id },
        });
      }
    } catch (e) {
      captureException(e, {
        tags: { layer: 'public-booking', step: 'refund-on-failure' },
        extra: { shopId: shop.id, paymentIntentId: input.payment_intent_id },
      });
    }
  }
  return err(...args);
};
```

(If the spread-typing of `err` fights you, give the helper an explicit
`(code: ErrorCode, fields?: Record<string, string>)` signature matching
`err`'s — check `lib/server-actions/result.ts` for the exact types.)

Import `refundOwnedIntentBestEffort` alongside the existing
`@/lib/stripe/payments` imports.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Route every post-charge failure through `failBooking`

Replace `return err(...)` with `return await failBooking(...)` at exactly the
sites in the Current-state table EXCEPT:

- The PI-verify-failed site (:633-641): replace too — the helper's ownership
  check makes it safe (`wrong_shop` → no refund; `wrong_amount` for our shop →
  refund proceeds because the destination matched).
- The link-services rollback site (:717-741): replace its final
  `return err('UNEXPECTED')` with `return await failBooking('UNEXPECTED')` and
  KEEP the existing orphan-capture block unchanged.

Do NOT touch failure returns that occur before the shop row exists (rate
limit, schema parse, honeypot, turnstile, shop-not-found) — at those points
there is no `shop.stripe_account_id` to verify ownership against, and the
wizard cannot have minted a PI for an unresolvable shop anyway.

**Verify**:
`grep -n "failBooking(" "app/[locale]/book/[shopSlug]/actions.ts"` → at least
10 call sites (the 10 table rows). `pnpm typecheck` → exit 0.

### Step 4: Reject bookings whose end time crosses midnight (closes the `% 1440` wrap)

`formatMinutes` (same file, ~line 951-955) wraps with `% 1440`, so an end at
24:00+ becomes "00:00" and defeats `checkAvailability`'s `slotEnd > close`
hours check. Just before the `checkAvailability` call (~line 454), add:

```ts
// formatMinutes wraps at 1440 ('24:30' → '00:30'), which would defeat the
// closing-hours check below. A booking may not cross shop-local midnight.
if (toMinutes(input.start_time) + totalMinutes > 1440) {
  return await failBooking('INVALID_INPUT');
}
```

**Verify**: `pnpm typecheck` → exit 0.

### Step 5: Full gates

**Verify**: `pnpm test` → all pass (no booking tests exist yet — plan 015 adds
them; this step is regression cover for the rest). `pnpm lint` → exit 0.
`pnpm format:check` → exit 0. `pnpm build` (with the placeholder env vars from
plans/README.md if no `.env.local`) → exit 0.

## Test plan

- No test harness exists yet for server actions (plan 015 builds it). This
  plan's machine verification is typecheck + grep-counts + build.
- `refundOwnedIntentBestEffort` IS unit-testable now: add 3 cases to
  `lib/stripe/payments.test.ts` following its existing mocking style
  (`vi.mock('./server')` with a fake `stripe.paymentIntents.retrieve` /
  `stripe.refunds.create`): (1) wrong destination → `{refunded:false,
  reason:'wrong_shop'}` and `refunds.create` NOT called; (2)
  `requires_payment_method` status → `not_charged`, no refund; (3) succeeded +
  matching destination → `refunds.create` called with the PI's amount.
- When plan 015 lands, add flow tests: 23505 conflict with a charged PI →
  refund called; promo `first_only` rejection with charged PI → refund called.

## Done criteria

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0; 3 new tests in `lib/stripe/payments.test.ts` pass
- [ ] `grep -c "failBooking(" "app/[locale]/book/[shopSlug]/actions.ts"` ≥ 10
- [ ] `grep -n "refundOwnedIntentBestEffort" lib/stripe/payments.ts` → defined once, exported
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the Current-state locations doesn't match the excerpts (drift).
- `err()`'s signature in `lib/server-actions/result.ts` can't express the
  helper wrapper without `any` — report the actual signature instead of forcing it.
- You find a code path where the PI could already be **partially refunded** or
  the appointment partially persisted at the failure point — report rather than
  guessing the refund amount.
- A verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The structural fix is a **manual-capture** PI (authorize at confirm, capture
  only after the appointment row inserts). That removes the refund window
  entirely but changes the Stripe Elements flow and the webhook expectations —
  deliberately deferred; revisit if refund-on-failure shows up in Sentry more
  than rarely.
- Plan 014 will restructure the pricing section of this same function — land
  001 first (it's the safety net), then 014 rebases on it.
- Reviewer: scrutinize that `failBooking` is used on EVERY post-charge return
  and on no pre-shop-resolution return; and that the `wrong_shop` branch never
  refunds.
