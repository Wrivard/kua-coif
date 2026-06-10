# Plan 015: Supabase mock harness + tests for the three money flows

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- lib/server-actions/with-action.test.ts lib/stripe/payments.test.ts app/api/webhooks/stripe/route.ts "app/[locale]/book/[shopSlug]/actions.ts" "app/[locale]/(app)/actions.ts"`
> Plans 001/004/007/014 legitimately changed the two action files — read the
> CURRENT code of the functions under test before writing fixtures; the
> behaviors this plan asserts (listed per suite below) are stable across those
> plans. STOP only if a listed behavior itself changed.

## Status

- **Priority**: P1
- **Effort**: L (harness ~a day; each suite S afterwards)
- **Risk**: MED (the classic failure is a too-permissive mock that tests the
  mock — countered by asserting on CAPTURED FILTERS, not just outcomes)
- **Depends on**: plan 014 (pricing extracted = less to mock)
- **Category**: tests
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

The repo has 164 sharp unit tests — ALL on the pure leaf layer. The wiring
layer where the product actually moves money — 81 `withAction` consumers and
9 API routes — has **zero** tests: the public booking action (Stripe verify,
conflict mapping, rollback), the Stripe webhook (dedupe, refund-revert,
disputes — a layer that already shipped one broken idempotency check), and the
four refund paths with their role/policy/IDOR gates. Today a column rename, a
dropped `.eq` filter, or an inverted policy comparison ships completely green.
The missing piece is a fixture-driven Supabase mock (the roadmap's declared
KEYSTONE): one chainable builder that lets action/route tests run against
in-memory tables. Build it once; the three most dangerous flows get suites in
the same plan.

## Current state

- Mocking idioms already proven in this repo (copy them):
  - `lib/stripe/payments.test.ts:5-17` — hand-rolled chainable
    (`from→update→eq` returning `vi.fn()`s) + assertions on the captured
    filter args (`expect(eq).toHaveBeenCalledWith('payment_intent_id','pi_123')`).
  - `lib/server-actions/with-action.test.ts` — module-mocks
    `@/lib/auth/server` to fabricate ctx (read it in full before starting —
    it is the exemplar for mocking the auth seam).
- Seams the three suites must mock (verify each import path in the target
  files before writing the mock — they are the CURRENT paths at `ef34cee`):
  - `@/lib/supabase/service-role` → `createSupabaseServiceRoleClient`
  - `@/lib/supabase/server` → `createSupabaseServerClient`
  - `@/lib/auth/server` (withAction ctx: user, role, shopId, barberId)
  - `@/lib/stripe/payments` (verify/refund/mint helpers) and/or
    `@/lib/stripe/server` (`getStripe`) for the webhook suite
  - `next/headers` (the public action reads request headers for `clientIp`)
  - `@/lib/security/turnstile` (`verifyTurnstile` → ok), `@/lib/auth/rate-limit`
    (`checkRateLimit` → allowed)
  - `@/lib/email/send`, `@/lib/sms/dispatch`, `@/lib/google/sync`,
    `@/lib/business/waitlist-notify`, `@/lib/quickbooks/sync`,
    `@/lib/notifications/slack` (side-effect sinks → spies)
  - `@/lib/observability` (`captureException` → spy; assert on it for the
    orphan/refund-skip paths)
- The webhook route verifies signatures via the real Stripe SDK —
  `stripe.webhooks.generateTestHeaderString` mints valid test signatures
  OFFLINE (no network), so the suite can POST realistic `NextRequest`s.
- Vitest env is jsdom with globals (vitest.config.ts:12-15); test glob is
  `**/*.test.{ts,tsx}` — suites under `app/**` are picked up automatically.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| New harness tests | `pnpm vitest run lib/test` | all pass |
| Suites | `pnpm vitest run "app/[locale]/book" app/api/webhooks "app/[locale]/(app)"` | all pass |
| Full | `pnpm test` && `pnpm typecheck` && `pnpm lint` | all green |

## Scope

**In scope**:
- NEW `lib/test/supabase-mock.ts` (+ `lib/test/supabase-mock.test.ts` —
  the harness gets its own tests)
- NEW `app/[locale]/book/[shopSlug]/actions.test.ts`
- NEW `app/api/webhooks/stripe/route.test.ts`
- NEW `app/[locale]/(app)/actions.cancel-refund.test.ts`

**Out of scope**:
- Changing ANY production file. If a test can't be written without a
  production change (e.g. an unexported symbol), STOP and report the exact
  export needed — do not refactor on your own.
- E2E/Playwright (plan 016). Coverage tooling (plan 016).

## Git workflow

- One commit per artifact (harness, then each suite):
  `test(harness): fixture-driven supabase mock` /
  `test(booking|webhook|refunds): …`. Do NOT push unless instructed.

## Steps

### Step 1: The harness — `lib/test/supabase-mock.ts`

API shape (drive the design from the call patterns in the three target files
— read them first and list every method they chain):

```ts
type Fixtures = Record<string, Array<Record<string, unknown>>>; // table → rows
export function createSupabaseMock(fixtures: Fixtures, opts?: {
  /** Per-table error injection: { appointments: { insert: { code: '23505' } } } */
  errors?: Record<string, Partial<Record<'select'|'insert'|'update'|'delete'|'upsert', { code?: string; message?: string }>>>;
}) : {
  client: any;                       // pass to vi.mocked factories
  calls: Array<{ table: string; op: string; filters: Array<[string, unknown]>; payload?: unknown }>;
}
```

Behavior: `from(t)` returns a builder supporting the chains actually used —
`select(cols)`, `insert(payload)`, `update(payload)`, `delete()`, `upsert(p,
opts)`, `eq/neq/gt/gte/lt/lte/in/is/not/or/ilike`, `order`, `limit`, `range`,
`single`, `maybeSingle`, `rpc(name, args)` on the root. Resolution: filter the
fixture rows by the captured `eq/in/gte/lte/is` filters (simple predicate
evaluation — implement only the operators the targets use; throw
`new Error('supabase-mock: unsupported op ' + op)` for anything else so gaps
are LOUD). `insert` appends (generating `id` when absent and `.select()` is
chained), `update` mutates matching rows, `single` returns
`{ data: rows[0] ?? null, error: rows.length ? null : { code: 'PGRST116' } }`.
Every call is recorded in `calls` so tests assert filters (the anti-
test-the-mock measure). Error injection short-circuits with `{ data: null,
error }`.

Harness self-tests (`lib/test/supabase-mock.test.ts`): chained filters narrow
correctly; insert+select returns the row; injected 23505 surfaces; unsupported
op throws.

**Verify**: `pnpm vitest run lib/test` → all pass.

### Step 2: Booking suite — `app/[locale]/book/[shopSlug]/actions.test.ts`

Mock the seams listed above (`vi.mock` at module top; fabricate headers with a
Map-like). Fixtures: one shop (with `stripe_account_id`, `payment_mode`),
services, hours, empty appointments/blocked, barber_settings shop row, a
client. Cases (assert RESULT + the key `calls` entries + spies):

1. happy path no-payment → `ok`, appointment + appointment_services inserted,
   confirmation email spy called;
2. slot race: inject 23505 on `appointments.insert` → `err('CONFLICT')` AND
   (post-plan-001) the refund helper spy called when a `payment_intent_id`
   was supplied;
3. PI verify rejects (mock `verifyDepositPaymentIntent` → `{valid:false,
   reason:'wrong_amount'}`) → `err('UNEXPECTED')` + Sentry spy;
4. promo `first_appointment_only` with an existing prior appointment fixture →
   `err('INVALID_INPUT', { promo_code: 'first_only' })`;
5. link-services failure (inject error on `appointment_services.insert`) →
   compensating DELETE recorded in `calls` for the new appointment id;
6. honeypot filled → `ok({ id: 'honeypot-discard' })` and ZERO db calls.

**Verify**: `pnpm vitest run "app/[locale]/book"` → all pass.

### Step 3: Webhook suite — `app/api/webhooks/stripe/route.test.ts`

Build `NextRequest`s with bodies signed via
`stripe.webhooks.generateTestHeaderString({ payload, secret })` (set
`STRIPE_WEBHOOK_SECRET` env in the test). Mock the supabase seam with
fixtures. Cases:

1. valid `payment_intent.succeeded` for a known PI → appointments update to
   'paid' recorded with `.eq('payment_intent_id', …)`;
2. duplicate event id: inject 23505 on `stripe_events.insert` → handler
   skipped (no appointments call), response ok;
3. `charge.refund.updated` failed-refund → update 'paid' recorded ONLY with a
   prior 'refunded' filter (read the live `revertRefundForIntent` for the
   exact guard and assert it);
4. invalid signature → 400, zero db calls;
5. dispute event with no matching shop → no insert + Sentry spy (read the
   live `persistDispute` first; if resolving the shop requires
   `charges.retrieve`, mock `getStripe` accordingly).

**Verify**: `pnpm vitest run app/api/webhooks` → all pass.

### Step 4: Cancel/refund matrix — `app/[locale]/(app)/actions.cancel-refund.test.ts`

Mock `@/lib/auth/server` for ctx (the with-action.test.ts idiom). Matrix over
`cancelAppointment` (+ `refundAppointment` spot cases): role barber×own /
barber×other / manager; paid×{inside,outside} refund window (barber_settings
fixture rows); `also_refund` with `force_refund`; post-plan-004: cancel on
`completed` → `terminal_status_locked`; shop-B row id under shop-A ctx →
`NOT_FOUND`. Assert `refundPaymentIntentFull` spy called/not-called per cell
and `markRefundedByIntent` ordering (refund BEFORE the status write).

**Verify**: `pnpm vitest run "app/[locale]/(app)"` → all pass.

### Step 5: Full gates

**Verify**: `pnpm test` → ALL pass (old 164 + new); `pnpm typecheck`,
`pnpm lint`, `pnpm format:check` → exit 0.

## Test plan

This plan IS the test plan. Minimum new tests: harness ≥ 4, booking ≥ 6,
webhook ≥ 5, cancel/refund ≥ 8.

## Done criteria

- [ ] `lib/test/supabase-mock.ts` exists; unsupported ops throw loudly
- [ ] ≥ 23 new tests, all passing; full `pnpm test` green
- [ ] Each suite asserts at least one CAPTURED FILTER (not only outcomes)
- [ ] Zero production-file changes (`git status` shows only the 4 new test files + harness)
- [ ] `plans/README.md` status row updated

## STOP conditions

- A target file's supabase usage needs an operator the harness doesn't
  implement and that operator is non-trivial (`.or()` with nested syntax,
  embedded selects `services(...)`) — implement the MINIMUM faithful version
  or STOP and report if fidelity is doubtful (embedded-select join emulation
  is the likely hard spot in the webhook's dispute path).
- The webhook route's handlers are not reachable without exporting internals —
  report the exact export wanted (e.g. `export { persistDispute } // for tests`)
  and wait.
- jsdom interferes with `NextRequest`/crypto in the webhook suite — try
  `// @vitest-environment node` per-file FIRST; report only if that fails.

## Maintenance notes

- The harness is now the standard for action/route tests — new money/tenancy
  code ships with a suite or doesn't ship.
- When db/types.ts regenerates, consider typing `Fixtures` against
  `Database['public']['Tables']` (plan 023 territory — optional).
- Next candidates once this exists (recorded, not in scope): slots route grid
  test, anonymize/merge compliance suite, reminder-cron idempotency, /me
  self-cancel token matrix.
