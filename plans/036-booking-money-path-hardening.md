# Plan 036: Booking money-path — never charge a card that won't book, and recover when it fails

> **Executor instructions**: This plan touches a MONEY path. Follow it exactly,
> run every verification, and honor the STOP conditions — several are about not
> introducing a double-charge or a charged-no-booking. When done, update this
> plan's row in `plans/README.md` (unless a reviewer told you they maintain it).
>
> **Drift check (run first)**: `git diff --stat 9e6ce12..HEAD -- "app/[locale]/book/[shopSlug]/booking-wizard.tsx" "app/[locale]/book/[shopSlug]/booking-payment-section.tsx" "app/[locale]/book/[shopSlug]/actions.ts"`
> If any in-scope file changed, compare the excerpts below against the live code
> before proceeding; on a mismatch, treat it as a STOP condition. **Note**: plans
> 001/014/018/022 (all DONE) and plan 035 (run BEFORE this) also touch these files.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED-HIGH (Stripe charge ordering + refund routing; a wrong edit can
  double-charge or leave a charged-no-booking — STOP rules are load-bearing)
- **Depends on**: **plan 035** (same `booking-wizard.tsx`; 035 lands the non-money
  booking fixes first to keep this diff small). Overlaps plan-001's `failBooking` net
  and the security review.
- **Category**: bug
- **Planned at**: commit `9e6ce12`, 2026-06-10

## Why this matters

The wizard charges the card **before** the booking is validated, and several
post-charge rejection paths don't refund:

- `booking-wizard.tsx:601-668` — `submit()` calls `paymentRef.current.confirmPayment()`
  (charges) at `:611`, THEN `bookPublicAppointment(...)` at `:634`.
- `actions.ts:240-263` — the `failBooking` helper (plan 001) refunds on post-charge
  failure, and its comment promises "Every post-charge failure return below routes
  through `failBooking`." But the validation returns at `actions.ts:336-377`
  (services `NOT_FOUND`, promo `invalid`/`expired`/`used`, barber `INVALID_INPUT`) are
  plain `return err(...)` — **they do NOT refund.** A customer who typos a promo code
  (the wizard only validates promo at submit) gets charged, rejected, and not refunded.
- The PRE-shop returns (`actions.ts:160-166` zod, `:181-183` turnstile) happen after
  the charge with no refund possible (the shop/PI aren't resolved yet) — the fix there
  is to not charge until the booking is known-valid.

Plus three recovery gaps: failures show one generic toast with no field errors and no
way back (CONFLICT tells the user to "reload the page", and the single-use Turnstile
token + consumed PaymentIntent make in-place retry impossible); the Confirm button
doesn't gate on payment-section readiness, so a stale PI can be charged at the wrong
amount; and the PI-failed state says "try again" with no retry control.

## Current state

- `booking-wizard.tsx:601-668` — `submit()`: `confirmPayment()` (charge) → `bookPublicAppointment(...)`
  → `if (result.ok) step=5 else show({ title: tErr(result.errorCode) })`. **`result.fieldErrors`
  is never read**, and there is no per-error-code recovery.
- `booking-payment-section.tsx:164-216` — the PI mint effect: keeps `kind:'ready'` with the
  OLD `paymentIntentId`/amount during a debounced (350ms) re-mint (`:178`). `:218-244` —
  the imperative handle exposes `confirmPayment()` and `isReady()` (`isReady` = `state.kind==='ready'||'no_deposit'`); **`isReady()` has no callers**. `:226` — a not-ready confirm
  returns `{ kind:'error', message:'NOT_READY' }` (the wizard shows the raw string).
  `:261-270` — the `error` state renders `t('intentFailed')` but the mint effect only re-fires
  on serviceKey/email/promo/phone/tip change (`:216`) — no retry.
- `actions.ts:153-263` — `bookPublicAppointment`: rate-limit → zod (`:159-166` plain err) →
  honeypot → turnstile (`:180-183` plain err) → `try { resolve shop (:229 plain err) →
  define failBooking (:240) → resolve services/promo/barber → validate (:336-377 plain err)
  → availability → insert → audit }`.

Convention: server actions return `Result<T>` via `ok`/`err`; `err(code, fieldErrors?)`
carries a field-error map (the wizard already receives it, just ignores it). The Stripe
confirm handle lives in `booking-payment-section.tsx`. Refunds via
`refundOwnedIntentBestEffort` (shop-scoped, idempotent, safe on the wrong-shop path).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass (245); the booking action suite (`actions.test.ts`) is the safety net |
| Lint | `pnpm lint` | exit 0 |
| Format | `pnpm format:check` | exit 0 |
| Build | `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key pnpm build` | exit 0 |

## Scope

**In scope**: `app/[locale]/book/[shopSlug]/actions.ts` (refund routing + optional
dry-run), `app/[locale]/book/[shopSlug]/booking-wizard.tsx` (client prevalidation +
recovery), `app/[locale]/book/[shopSlug]/booking-payment-section.tsx` (readiness +
retry), `messages/{fr,en}.json` (localize NOT_READY + recovery copy),
`app/[locale]/book/[shopSlug]/actions.test.ts` (new assertions).

**Out of scope**: the non-money booking fixes (plan 035 — closed-day, abort-race, etc.),
pricing math (plan 014, DONE), the `as any` casts (plan 023), any change to Stripe webhook
handling.

## Git workflow

- Branch: `advisor/036-booking-money-path`. Commit per step; conventional commits, e.g.
  `fix(booking): route every post-charge failure through the refund net`.
- Co-Authored-By footer. Do NOT push unless instructed.

## Steps

### Step 1: Route EVERY post-charge return through `failBooking` (the concrete money fix)

In `actions.ts`, after `failBooking` is defined (`:240`), change every `return err(...)`
between there and the successful insert to `return failBooking(...)` — specifically the
services/promo/barber validations (`:336, 348, 354, 357, 372, 375`), the availability
failure, and the insert/`23505` conflict path. (The pre-`failBooking` returns —
rate-limit, zod, honeypot, turnstile, shop-not-found — stay `err`, but Step 2/3 stop the
charge from happening before those.) `failBooking` already no-ops safely when there's no
`payment_intent_id`.

**Verify**: `grep -n "return err(" "app/[locale]/book/[shopSlug]/actions.ts"` — only the
pre-`failBooking` returns remain (rate-limit/zod/honeypot/turnstile/shop). `pnpm test` →
the booking suite passes; ADD a test: a post-charge validation failure (e.g. invalid promo
with a `payment_intent_id` present) calls the refund path.

### Step 2: Client-side prevalidation so common typos never reach a charge

In `booking-wizard.tsx`, mirror the server zod rules in the step-4 gate so the card isn't
charged on a client-detectable error: validate email (`.email()`) and phone format before
`canAdvance` allows Confirm (wire `PhoneInput`'s unused `invalid` prop), and surface promo
validation earlier if cheap. This makes the typo'd-email/phone case a pre-charge inline
error, not a post-charge refund.

**Verify**: dev server: a malformed email/phone blocks Confirm with an inline message and
NO Stripe charge fires (network tab shows no `confirmPayment`).

### Step 3: Gate Confirm on payment readiness + localize NOT_READY (BUG-03)

Wire the existing `isReady()` into the wizard: Confirm is `disabled` (or shows a spinner)
while the payment section is minting/not-ready. In `booking-payment-section.tsx`, add an
`inFlight`/`minting` sub-state set true during the debounce+request window (`:164-216`) and
expose it (extend the imperative handle); the wizard consults it. Replace the raw
`NOT_READY` toast in the wizard with a localized "Le paiement se prépare, réessaie dans un
instant" (`pages.booking.payment.notReady`, both locales). Show a small "mise à jour du
total…" hint near the amount while minting.

**Verify**: dev server: tapping a tip then immediately Confirm does NOT charge the stale PI
(Confirm is disabled until the new PI is ready); no raw "NOT_READY" string ever shows.

### Step 4: Field errors + recoverable failure (BUG-02)

In `submit()`'s failure branch, read `result.fieldErrors` and render inline messages
(promo/phone/email) using the wizard's existing `FieldHint` mechanism. Add per-code
recovery: on `CONFLICT`, route back to the slot step (`step:3`, `startTime:null`) and
re-fetch slots with an inline "ce créneau vient d'être pris" banner — NOT "reload the
page". On any failure that consumed the Turnstile token or the PaymentIntent, reset them so
a retry is possible (`turnstileRef.reset()` — the API exists at `turnstile.tsx:41`; re-arm
the payment section, e.g. via a `refresh()` method that bumps a retry nonce).

**Verify**: dev server: a simulated slot-conflict returns the user to the slot step with a
clear banner and a usable form (Turnstile re-armed); promo/phone field errors show inline.

### Step 5: Retry control on PI failure (BUG-09)

In `booking-payment-section.tsx`, add a retry button to the `error` state (`:261-270`) that
bumps a `retryNonce` included in the mint effect's deps so a transient Stripe/network
failure can be retried without re-entering the whole flow.

**Verify**: dev server: forcing a mint failure shows a Retry button that re-mints the PI.

## Test plan

- `actions.test.ts` (the existing booking suite, built on the Supabase mock harness): ADD
  cases — (a) a post-charge validation failure with a `payment_intent_id` triggers the
  refund net; (b) the honeypot/turnstile pre-charge paths still return without a refund call
  (no PI yet). Model after the existing refund-on-failure tests (plan 001/015).
- Manual matrix: typo email → no charge; tip-then-confirm race → no stale charge; invalid
  promo with deposit → charged-then-refunded (or, post Step 2, blocked pre-charge);
  slot-conflict → back to slot step, retryable; PI failure → Retry works.
- `pnpm test` → 245 (+ new) pass.

## Done criteria

- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm format:check` exit 0
- [ ] `pnpm build` exits 0; `pnpm test` exits 0 with new refund-routing tests
- [ ] `grep -n "return err(" "app/[locale]/book/[shopSlug]/actions.ts"` shows ONLY the
      pre-`failBooking` returns
- [ ] No raw `NOT_READY` string reachable; new i18n keys present in BOTH message files
- [ ] Confirm is gated on payment readiness; a stale-PI charge is not possible (manual)
- [ ] CONFLICT routes back to the slot step (no "reload the page"); Turnstile re-armed
- [ ] No out-of-scope file modified (`git status`)
- [ ] `plans/README.md` row updated

## STOP conditions

- You cannot confirm that re-arming the PaymentIntent for retry won't double-charge (Stripe
  `payment_intent_unexpected_state`) — STOP and report; a wrong retry path is worse than the
  current dead-end.
- Routing a return through `failBooking` would refund a PI that legitimately captured money
  for a SUCCEEDED booking (e.g. you mis-identify a success path as a failure) — STOP; only
  FAILURE returns route through `failBooking`.
- You consider a server `dry_run` prevalidation that VERIFIES Turnstile before the real
  booking: Turnstile tokens are single-use (`lib/security/turnstile.ts`), so a dry-run that
  consumes the token breaks the real call. Do NOT ship that without an explicit token-handling
  design — STOP and escalate (Steps 1–5 deliver the fix without it; full server prevalidation
  is a follow-up that needs the token decision).
- The booking test suite goes red and the failure is a REAL behavior change (not a test that
  needs updating to the new refund routing) — STOP.

## Maintenance notes

- **Reviewer**: this is the highest-risk plan in the set. Verify (1) every post-charge return
  refunds, (2) no path double-charges, (3) Confirm can't fire on a stale PI, (4) the new tests
  actually exercise the refund net. Read `failBooking` and the `submit()` ordering line by line.
- **Deferred**: full server-side prevalidation (charge ONLY after a server dry-run confirms
  the booking) — the cleanest end state, gated on resolving Turnstile single-use. File as a
  follow-up once Steps 1–5 land and the token approach is decided.
- This composes with plan 035 (which fixed the closed-day/abort/availability UX on the same
  file) — land 035 first.
