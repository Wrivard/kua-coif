# Plan 018: Cut the public booking submit latency — parallel preamble, deferred email, batched email-config reads

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- "app/[locale]/book/[shopSlug]/actions.ts" lib/email/send.ts`
> Plans 001/014 changed this action (refund helper, pricing delegation) —
> expected; compare the SEQUENCING excerpts below against live code and STOP
> on structural mismatch.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (reordering reads on the money path — the plan only
  parallelizes reads whose inputs are independent, and keeps every validation
  ORDER-OBSERVABLE effect identical; the email defer changes failure
  semantics from "never blocked" (already true in intent) to "also never
  delays")
- **Depends on**: plans 001 + 014 (same file — land first)
- **Category**: perf
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

The single most valuable conversion action — the customer's booking confirm —
carries ~15-19 SEQUENTIAL round-trips plus Turnstile + Stripe verify, and
then **awaits the confirmation email inline** (`await sendEmail(...)` whose
surrounding comment claims "We deliberately do NOT block on the send" — it
does block; SMTP transports routinely take 0.5–2s). On top, `sendEmail` does
2 internal DB reads per call (automation gate + shop SMTP config). Tail
latency for the spinner easily reaches 2–4s. Three independent reads at the
top depend only on `shop.id` and can run as one batch; the email belongs
after the response.

## Current state

(all in `app/[locale]/book/[shopSlug]/actions.ts` at `ef34cee`)

- Sequential preamble: shop by alias (:190-226) → services (:231-254) →
  promo (:276-310, only when `input.promo_code`) → barber resolve/validate
  (:318-347) → THEN the 5-query availability `Promise.all` (:356+). services,
  promo and barber depend ONLY on `shop.id` — parallelizable as one batch.
  CAUTION on observable ordering: with an invalid promo AND an invalid
  barber, today the promo error wins (it's checked first). Preserve that by
  keeping the VALIDATION/short-circuit order after the parallel FETCH
  (fetch in parallel, validate in the current order).
- Barber `display_name` re-query late (:823-831) although the explicit-barber
  path already queried the row (:338-346, `select('id')` only) — widen that
  select to `'id, display_name'` and reuse; the 'any' path (:322-330) can add
  `display_name` to its select too.
- `me_token_version` fresh read (:856-864) although the client row was read
  (:496-504 `select('id, loyalty_balance_cents, loyalty_balance_expires_at')`)
  or inserted (:525-535 `.select('id')`) — add `me_token_version` to both.
- The awaited email (:883-919) — `await sendEmail({ ... })`.
- `lib/email/send.ts`: `isAutomationEnabled` (:84-97, one DB read) and the
  SMTP config lookup (`getShopSmtpConfig(input.shopId)`, :128-131, second
  read) run per call.
- Vercel: `next/server` exports `waitUntil` via `import { waitUntil } from
  '@vercel/functions'` — VERIFY availability: `@vercel/functions` is NOT in
  package.json today. Fallback if not adding a dep: fire-and-forget
  `void sendEmail(...).catch(...)` — acceptable on Vercel ONLY inside
  `after()` (Next 15) or with waitUntil; on Next 14, a bare void promise can
  be killed at response end. DECISION: add `@vercel/functions` (tiny,
  official) and use `waitUntil`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm add @vercel/functions` | lockfile updated |
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass |
| Build | `pnpm build` | exit 0 |

## Scope

**In scope**:
- `app/[locale]/book/[shopSlug]/actions.ts` (sequencing + select-widening +
  email defer)
- `lib/email/send.ts` (optional preloaded-config params)
- `package.json`/lockfile (`@vercel/functions`)

**Out of scope**:
- The marketing/cron send LOOPS (their batching is a separate concern —
  plan 008 bounded them; loop parallelization deferred).
- The slots route (plan 017). The wizard client.
- Any change to validation SEMANTICS or error codes.

## Git workflow

- Conventional commit: `perf(booking): parallel preamble + deferred confirmation email`.
- Do NOT push unless instructed.

## Steps

### Step 1: Parallel preamble

After the shop resolve, run services + promo (when provided) + barber
(explicit-id path with `display_name`; or 'any' pick) in ONE `Promise.all`,
then perform the existing validations in their CURRENT order on the fetched
results. Keep each validation's error codes byte-identical.

**Verify**: `pnpm typecheck`; behavior probe — `pnpm test` (the plan-015
booking suite, if landed, must stay green; if not landed yet, state so).

### Step 2: Kill the two redundant re-reads

Widen the barber selects (`display_name`) and the client lookup/insert
selects (`me_token_version`); delete the :823-831 and :856-864 queries,
reading from the earlier results.

**Verify**: `grep -n "display_name" "app/[locale]/book/[shopSlug]/actions.ts"`
→ no standalone barber query after the insert section;
`grep -c "me_token_version" "app/[locale]/book/[shopSlug]/actions.ts"` →
references only in the widened selects + token mint.

### Step 3: Defer the email

Replace the `await sendEmail({...})` block with:

```ts
import { waitUntil } from '@vercel/functions';
...
waitUntil(
  sendEmail({ ...same args... }).catch((e) =>
    captureException(e, { tags: { layer: 'public-booking', step: 'confirmation-email-deferred' } }),
  ),
);
```

Build the template inputs BEFORE the response exactly as today (no lazy
closures over mutable state). Update the stale comment ("we await so the
action's tail latency reflects the send" — now false). The Slack notify just
below is already fire-and-forget — leave it.

**Verify**: `pnpm typecheck`; `pnpm build` → exit 0 (waitUntil is
runtime-safe on nodejs runtime; it no-ops to background-promise outside
Vercel — verify the package README claim and note it).

### Step 4: Batch sendEmail's config reads (shared win for crons/campaigns)

In `lib/email/send.ts`, extend `SendEmailInput` with optional
`preloaded?: { automationEnabled?: boolean; smtpCfg?: ShopSmtpConfig | null }`
— when present, skip the corresponding lookup. Callers in this plan don't need
it (single send), but the reminder/birthday/campaign loops can preload per
shop; wire ONE caller as the exemplar: the notifications cron's send loop
(load the automation rows + smtp configs for the distinct shopIds once per
tick, pass them down). Keep the fallback path identical.

**Verify**: `pnpm typecheck`; `pnpm test`; `grep -n "preloaded" lib/email/send.ts app/api/cron/notifications/route.ts` → both wired.

### Step 5: Gates

**Verify**: full `pnpm test`, lint, format, build → green.

## Test plan

- If plan 015's booking suite exists: it must pass unchanged (validation
  ordering preserved) — plus add one case: email failure (sendEmail mock
  rejects) does NOT affect the action result.
- Latency evidence: in your report, count the awaited round-trips
  before/after on the happy path (target: preamble 4→2 awaits; email off the
  critical path).

## Done criteria

- [ ] Preamble: services/promo/barber fetched in one Promise.all; validation
      order unchanged (state how verified)
- [ ] Zero standalone display_name / me_token_version re-queries
- [ ] Email send via waitUntil + catch→Sentry; stale comments rewritten
- [ ] sendEmail supports preloaded config; notifications cron preloads
- [ ] typecheck/test/lint/format/build all green
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `@vercel/functions`' waitUntil is incompatible with Next 14.2 route/server
  actions (verify its peer range BEFORE installing) — fall back to keeping the
  await and report (do not ship a maybe-killed void promise).
- Parallelizing changes an error-precedence a test depends on — report the
  case, don't reorder validations.
- The promo fetch's absence-vs-invalid distinction (`promo_code: 'invalid'`)
  somehow requires the sequential shape — report.

## Maintenance notes

- When the repo reaches Next 15 (plan 021), swap waitUntil for the built-in
  `unstable_after`/`after()` API and drop the dep.
- The preloaded-config seam is the building block for parallelizing the
  campaign loops later (deferred from plan 008's scope).
