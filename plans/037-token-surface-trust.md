# Plan 037: Token-surface trust — reschedule confirmation email, loyalty truth, expired-link landing

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> When done, update this plan's row in `plans/README.md` (unless a reviewer told
> you they maintain the index).
>
> **Drift check (run first)**: `git diff --stat 9e6ce12..HEAD -- "app/[locale]/reschedule/[token]" "app/[locale]/me/[token]/page.tsx" "app/[locale]/not-found.tsx" lib/business/loyalty.ts`
> If any in-scope file changed, compare the "Current state" excerpts against the
> live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S-M
- **Risk**: LOW (additive email + an already-built loyalty helper + new fallback route files; the only behavior change is "send an email that was promised" and "show the effective balance")
- **Depends on**: none. Unblocks 043 (review pack — owns `review/[token]/*`) and
  044 (/me hub — owns the per-appointment links + cancel-policy transparency UX-03).
  Keep this plan OUT of `review/[token]/*` and `me-client.tsx` to stay file-disjoint
  from 043/044.
- **Category**: bug
- **Planned at**: commit `9e6ce12`, 2026-06-10

## Why this matters

The token-gated pages are the client's premium moments after booking; three of
them break trust:

- **The reschedule success screen promises an email that is never sent.** The done
  state says "Tu recevras une confirmation par courriel…"
  (`reschedule-client.tsx:139-143`) but the action only updates the row, audit-logs,
  and pushes Google — there is no `sendEmail` call (contrast the self-cancel action
  which DOES email, `me/[token]/actions.ts:451-468`). The customer re-checks, doubts
  the move happened, and calls the salon — the exact call self-service exists to
  prevent.
- **The /me loyalty hero shows the raw balance, including expired credit.** The
  page selects `loyalty_balance_cents` without the expiry and passes it straight to
  the hero (`me/[token]/page.tsx:44,135`), so it can display "10,00 $ — appliqué
  automatiquement" for credit that's already expired. The shop already has the
  helper that computes the effective balance (`effectiveLoyaltyBalanceCents`,
  `lib/business/loyalty.ts:47`); the page just doesn't call it.
- **Expired token links dead-end on a generic Küa 404.** Reschedule tokens live 7
  days, so a customer tapping a week-old "move my appointment" email gets the SaaS
  404 with "Go home → Küa root" (`app/[locale]/not-found.tsx`) — wrong brand, no
  salon context, no next step. Plus two small reschedule-screen bugs: a flaky slot
  fetch shows "no slots" instead of an error, and the success copy prints a raw ISO
  date.

## Current state

- `app/[locale]/reschedule/[token]/actions.ts:207-257` — the reschedule action:
  updates `start_at`/`end_at`, `logDurableAudit`, `void pushAppointment(...)`, then
  `return ok({ id: appt.id })`. **No email block.**
- `app/[locale]/me/[token]/actions.ts:411-468` — the EXEMPLAR email block to mirror:
  fetches `{ first_name, email }`, services, `{ name, timezone, phone }`; if
  `customer?.email && shop`, calls `sendEmail({ shopId, kind, to, subject, template, tags })`
  with locale from the URL; wrapped in try/catch that swallows + `captureException`.
- `app/[locale]/reschedule/[token]/reschedule-client.tsx:61-70` — slot fetch:
  `.then((r) => r.json()).then((d) => setSlots(d.slots ?? [])).catch(() => setSlots([]))`
  (no `r.ok` check; abort + error → "no slots"). `:139-143` — done copy interpolates
  `(${date} · ${startTime})` (raw ISO), while `:150-154` formats the CURRENT
  appointment with `formatHeaderDate(...) + formatShopTime(...)`.
- `app/[locale]/me/[token]/page.tsx:41-47` — select lists
  `…, loyalty_balance_cents, loyalty_counter, anonymized_at, me_token_version` but
  NOT `loyalty_balance_expires_at`. `:135` — `loyaltyBalanceCents: client.loyalty_balance_cents ?? 0`.
- `lib/business/loyalty.ts:47-56` — `effectiveLoyaltyBalanceCents({ clientId, balanceCents, expiresAt }): Promise<number>`
  (returns 0 if expired and lazily zeroes the row; safe to call server-side).
- `app/[locale]/not-found.tsx:5-22` — the ONLY not-found boundary: generic
  `FileQuestion` icon, `errors.notFound` strings, a `<Link href="/">` home button.
- The five token segments each call `notFound()` on bad/stale tokens
  (`me|review|receipt|reschedule|unsubscribe/[token]/page.tsx`).

Conventions: i18n strings in `messages/{fr,en}.json`, both required (parity test).
Email via `sendEmail` from `@/lib/email/*`; templates in `lib/email/templates/`
(the booking confirmation template is `AppointmentConfirmation` — verify the exact
export). Token pages format dates with `formatHeaderDate` + `formatShopTime` in the
shop timezone.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass (245); i18n-parity green |
| Lint | `pnpm lint` | exit 0 |
| Format | `pnpm format:check` | exit 0 |
| Build | `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key pnpm build` | exit 0 |

## Scope

**In scope**:
- `app/[locale]/reschedule/[token]/actions.ts` (CORRECTNESS-01 — send the email)
- `app/[locale]/reschedule/[token]/reschedule-client.tsx` (CORRECTNESS-03 slot
  error state + CORRECTNESS-05 formatted date)
- `app/[locale]/me/[token]/page.tsx` (CORRECTNESS-02 — effective loyalty balance)
- NEW `not-found.tsx` under each token segment: `me/[token]/`, `review/[token]/`,
  `receipt/[token]/`, `reschedule/[token]/`, `unsubscribe/[token]/` + ONE shared
  component (e.g. `components/token-link-invalid.tsx`) (UX-01)
- `messages/fr.json` + `messages/en.json` (new keys, both)

**Out of scope** (owned by other plans — do NOT touch, to stay file-disjoint):
- `app/[locale]/me/[token]/me-client.tsx` and the cancel-policy transparency
  (UX-03) → **plan 044**.
- `app/[locale]/review/[token]/*` (review stars a11y UX-04, dup-review
  CORRECTNESS-07, deep-links) → **plan 043**.
- The reschedule POLICY bypass (CORRECTNESS-04 — reschedule ignores
  `customer_cancellations` / refund window): it needs a PRODUCT decision (salons
  often prefer reschedules over cancels). Documented in Maintenance; not implemented.
- The `as any` casts on these files (plan 023).

## Git workflow

- Branch: `advisor/037-token-surface-trust`.
- One commit per step; conventional commits, e.g.
  `fix(reschedule): send the promised confirmation email`.
- Co-Authored-By footer. Do NOT push unless instructed.

## Steps

### Step 1: Send the reschedule confirmation email (CORRECTNESS-01)

In `reschedule/[token]/actions.ts`, after the successful update + audit (before or
alongside the Google push, best-effort), add an email block mirroring the
self-cancel exemplar (`me/[token]/actions.ts:411-468`): fetch the client
`first_name,email`, the appointment's services, and the shop `name,timezone,phone`;
if `email && shop`, `sendEmail({ shopId: appt.shop_id, kind: 'confirmation' /* or the reschedule kind */, to, subject (locale-branched), template, tags })`.
Use the booking confirmation template (`AppointmentConfirmation` — verify the export
in `lib/email/templates/`) populated with the NEW start time
(`newStartAt.toISOString()`), or a reschedule-specific template if one already
exists. Wrap in try/catch that swallows + `captureException({ tags: { layer: 'public-reschedule', step: 'email' } })`
so a send failure never fails the reschedule. Resolve the email locale from the
action input the same way the cancel action does (`parsed.data.locale`).

**Verify**: `pnpm typecheck` → exit 0. `grep -n "sendEmail" "app/[locale]/reschedule/[token]/actions.ts"` → now present. (Manual: a reschedule produces a confirmation email in the dev mailbox.)

### Step 2: Slot-fetch error state + formatted success date (CORRECTNESS-03 + 05)

In `reschedule-client.tsx`: mirror plan 035's slot-fetch hardening — add `r.ok`
check (`throw` on `!r.ok`), a `slotError` state, silence aborts
(`catch((e) => { if (ctl.signal.aborted) return; setSlotError(true); })`), and
render "Impossible de charger les disponibilités — réessayer" + a retry control on
error (distinct from the empty "Aucun créneau" state). Replace the raw-ISO done copy
(`:141-142`) with a formatted date in the shop timezone, reusing the same helpers as
the current-appointment line (`formatHeaderDate(new Date(\`${date}T${startTime}\`…), …, shop.timezone)` + `formatShopTime`).

**Verify**: dev server: killing the network on the reschedule slot step shows
"couldn't load, retry", not "no slots"; the success screen shows a human date
("17 juin · 14:30"), not "2026-06-17 · 14:30".

### Step 3: Show the EFFECTIVE loyalty balance on /me (CORRECTNESS-02)

In `me/[token]/page.tsx`: add `loyalty_balance_expires_at` to the client select
(`:44`), then before building the `client` prop compute
`const effectiveLoyaltyCents = await effectiveLoyaltyBalanceCents({ clientId: client.id, balanceCents: client.loyalty_balance_cents ?? 0, expiresAt: client.loyalty_balance_expires_at ?? null });`
and pass THAT as `loyaltyBalanceCents` (`:135`). (Import from `@/lib/business/loyalty`.)
`me-client.tsx` is unchanged — it already renders the value it's handed.

**Verify**: `pnpm typecheck` → exit 0. A client whose balance expired in the past
shows 0 on the /me hero (not the stale positive number).

### Step 4: Branded expired-link landing for token routes (UX-01)

Create one shared component (`components/token-link-invalid.tsx`) with a uniform,
bilingual message — e.g. "Ce lien n'est plus valide — il a peut-être expiré.
Contacte le salon pour en recevoir un nouveau." — NO home link, NO enumeration of
why (keep invalid/expired/revoked indistinguishable for security). Add a
`not-found.tsx` in each of the five token segments
(`me|review|receipt|reschedule|unsubscribe/[token]/`) that renders it. Add the
strings under a new `pages.tokenLink.*` namespace in BOTH message files.

**Verify**: `pnpm build` → exit 0. Hitting a token route with a garbage token shows
the salon-appropriate copy, not the Küa "Go home" 404. `ls app/[locale]/*/[token]/not-found.tsx`
→ five files.

## Test plan

- The reschedule action may have a test file
  (`reschedule/[token]/actions.test.ts`); if so, add an assertion that a successful
  reschedule attempts `sendEmail` (mock it, assert called once with the new time).
  Model after the self-cancel action's email assertion if one exists.
- No new test for the not-found routes (rendering-only); covered by the build +
  manual check.
- Manual matrix: reschedule → email arrives + formatted success date; slot-error
  state; expired /me loyalty shows 0; garbage token → branded landing on all five
  routes.
- `pnpm test` → 245 (+ any new) pass; i18n-parity green.

## Done criteria

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0; i18n-parity passes with new `pages.tokenLink.*` keys in BOTH files
- [ ] `pnpm lint` + `pnpm format:check` exit 0
- [ ] `pnpm build` exits 0
- [ ] `grep -rn "sendEmail" "app/[locale]/reschedule/[token]/actions.ts"` → present
- [ ] Five `not-found.tsx` exist under the token segments
- [ ] `grep -n "loyalty_balance_expires_at" "app/[locale]/me/[token]/page.tsx"` → present
- [ ] `me-client.tsx` and `review/[token]/*` NOT modified (`git status` — file-disjoint from 043/044)
- [ ] No files outside the in-scope list modified
- [ ] `plans/README.md` row updated

## STOP conditions

- No suitable email template exists in `lib/email/templates/` for a reschedule
  confirmation AND adapting `AppointmentConfirmation` would change its booking-flow
  behavior — STOP and report (a new template is a small but separate decision); do
  NOT just soften the success copy as a "fix".
- `effectiveLoyaltyBalanceCents` import creates a server/client boundary error
  (it's server-only because it uses the service-role client) — confirm `page.tsx`
  is a server component (it is); if a bundling error appears, STOP.
- A per-segment `not-found.tsx` doesn't catch the segment's `notFound()` (Next
  resolves to the nearest boundary) — verify in dev; if it bubbles to the root,
  STOP and report the routing nuance.

## Maintenance notes

- **Reviewer**: confirm the reschedule email is best-effort (a send failure does
  not fail the reschedule) and carries the NEW time, not the stale row values.
- **Deferred — needs a product decision (CORRECTNESS-04)**: the reschedule action
  honors none of the customer-cancellation policy, so a customer inside the
  no-refund window can reschedule out then cancel for a full refund (deposit-forfeit
  dodge). Closing the refund-dodge is the clear part; whether to block reschedules
  when `customer_cancellations=false` is the owner's call. Re-plan once decided.
- Plan 044 (/me hub) adds per-appointment reschedule/receipt links AND the
  cancel-policy transparency (UX-03) on `me-client.tsx` — it builds on the effective
  balance shipped here. Plan 043 (review pack) owns the review surface.
- Plan 035 hardens the booking slot fetch identically; keep the two error-state
  shapes consistent.
