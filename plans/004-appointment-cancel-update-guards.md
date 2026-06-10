# Plan 004: Terminal-status + active-shop guards on cancelAppointment / updateAppointment

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- "app/[locale]/(app)/actions.ts" "app/[locale]/(app)/appointment-detail-drawer.tsx"`
> On mismatch with the Current-state excerpts, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (additive guards mirroring patterns already in the same file)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

`cancelAppointment` never reads the row's `status`, so a **completed**
appointment can be flipped to `cancelled` — silently removing it from
/finances and the daily close-out after loyalty, review-request and QuickBooks
side-effects already fired. The same file's BULK cancel path explicitly guards
against this ("Cancelling a `completed` row silently destroys the finances
trail") and `updateAppointment` has a terminal-status lock — the single-cancel
path just never got the guard, and the UI renders the Cancel button on
completed rows, so it's reachable by a misclick, not just a crafted POST.
Second gap, same functions: `updateAppointment` and `cancelAppointment` look
the row up by bare id with no `shop_id === ctx.shopId` check, while their
siblings `rescheduleAppointment`/`resizeAppointment` do (`// RLS would have
hidden it, but belt-and-braces`). For a multi-shop member, RLS spans all their
shops but the role and audit `shopId` come from the ACTIVE shop — a shop-B row
can be mutated under shop-A authority and mis-attributed in the audit trail.

## Current state

All in `app/[locale]/(app)/actions.ts` (at `ef34cee`):

- `updateAppointment` pre-read (:330-341) — selects
  `status, client_id, total_amount, barber_id` by `.eq('id', id)` — **no
  `shop_id`** selected or checked. Terminal lock exists at :356-358.
- `cancelAppointment` pre-read (:739-751):

```ts
const preRes = await preSb
  .from('appointments')
  .select('barber_id, google_event_id, payment_intent_id, payment_status, start_at')
  .eq('id', input.id)
  .single();
```

  — **no `status`, no `shop_id`**. Unconditional write at :884-888:
  `update({ status: 'cancelled' }).eq('id', input.id)`.
- The patterns to copy, same file:
  - shop guard — `rescheduleAppointment` :438-439 and `resizeAppointment` :617:
    `if (appt.shop_id !== ctx.shopId) return err('NOT_FOUND'); // RLS would have hidden it, but belt-and-braces.`
  - terminal set — bulk path :1082-1085 uses
    `TERMINAL_STATES = {completed, cancelled, no_show}` and returns
    `err('INVALID_INPUT', { reason: 'terminal_status_in_batch' })`.
  - terminal lock message — `updateAppointment` :356-358 returns
    `err('INVALID_INPUT', { reason: 'terminal_status_locked' })`.
- UI: `app/[locale]/(app)/appointment-detail-drawer.tsx` — locate the cancel
  affordance gating with `grep -n "isCancelled" "app/[locale]/(app)/appointment-detail-drawer.tsx"`;
  today it treats only `cancelled`/`no_show` as hiding the Cancel action, so
  `completed` rows still show it.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass |
| Lint/format | `pnpm lint` && `pnpm format:check` | exit 0 |

## Scope

**In scope**:
- `app/[locale]/(app)/actions.ts` — `updateAppointment` + `cancelAppointment` only
- `app/[locale]/(app)/appointment-detail-drawer.tsx` — cancel-button gating only

**Out of scope**:
- `bulkCancelAppointments` (already guarded), `rescheduleAppointment`,
  `resizeAppointment` (already guarded), `refundAppointment`.
- `app/[locale]/me/[token]/actions.ts` self-cancel (plan 009 owns it; its
  status/ownership model is different — token-bound).
- i18n message files — reuse the existing `INVALID_INPUT` toast mapping; do
  not add new error strings.

## Git workflow

- Conventional commit: `fix(calendar): terminal-status + active-shop guards on cancel/update`.
- Do NOT push unless instructed.

## Steps

### Step 1: Guard `cancelAppointment`

Extend the pre-read select to
`'barber_id, google_event_id, payment_intent_id, payment_status, start_at, status, shop_id'`
(and the inline cast type accordingly: `status` is the appointment-status
union used elsewhere in the file; `shop_id: string`). Immediately after the
`if (!pre) return err('NOT_FOUND');` line add, in this order:

```ts
if (pre.shop_id !== ctx.shopId) return err('NOT_FOUND'); // RLS would have hidden it, but belt-and-braces.
// A terminal row must not be re-cancelled: 'completed' already fired
// loyalty/review/QuickBooks and feeds /finances; 'cancelled' may have been
// refunded; 'no_show' matches the bulk path's terminal set.
if (pre.status === 'completed' || pre.status === 'cancelled' || pre.status === 'no_show') {
  return err('INVALID_INPUT', { reason: 'terminal_status_locked' });
}
```

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Guard `updateAppointment`

Add `shop_id` to the pre-read select (:332) and its cast type; after the
`if (!prior) return err('NOT_FOUND');` add the same one-line shop guard
(`prior.shop_id !== ctx.shopId` → `err('NOT_FOUND')`). The terminal lock
already exists — do not duplicate it.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Hide the Cancel affordance on completed rows

In `appointment-detail-drawer.tsx`, find the `isCancelled`-style gate and
extend the hidden set to include `'completed'` (rename the variable to
`isTerminal` if that keeps the code honest — match local style). The
reschedule/status controls for completed rows: leave exactly as they are
today (updateAppointment's server lock is the authority; this step is
cosmetic consistency for the Cancel button only).

**Verify**: `pnpm typecheck` → exit 0. `grep -n "completed" "app/[locale]/(app)/appointment-detail-drawer.tsx" | head -20` shows the gate now references it.

### Step 4: Full gates

**Verify**: `pnpm test` → all pass. `pnpm lint` && `pnpm format:check` → exit 0.
`pnpm build` (placeholder env if needed) → exit 0.

## Test plan

- No action-level harness exists yet (plan 015). When it lands, add to its
  cancel/refund matrix: cancel on `completed` → `INVALID_INPUT
  terminal_status_locked`; cancel with a shop-B id under shop-A context →
  `NOT_FOUND`; cancel on `booked` → succeeds.
- Until then: machine gates above + manual smoke (operator): complete an
  appointment in the drawer → the Cancel button no longer renders; attempt is
  rejected server-side if forced.

## Done criteria

- [ ] `pnpm typecheck` exits 0; `pnpm test` exits 0
- [ ] `grep -n "terminal_status_locked" "app/[locale]/(app)/actions.ts"` → ≥ 2 matches (updateAppointment existing + cancelAppointment new)
- [ ] `grep -c "shop_id !== ctx.shopId" "app/[locale]/(app)/actions.ts"` → exactly 4 (reschedule, resize, update, cancel)
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The pre-read shapes at :330-341 / :739-751 don't match the excerpts (drift).
- The drawer's cancel gating has been restructured (no `isCancelled` symbol) —
  report what you find instead of improvising a UI refactor.
- You're tempted to add the same guards to other actions "while here" — the
  remaining file is out of scope (007/009/022 own other parts of it).

## Maintenance notes

- Reviewer: check the guard ORDER in cancel (shop guard before terminal guard,
  both before the barber-ownership check that follows) — error codes must not
  leak cross-shop row existence (`NOT_FOUND`, not `FORBIDDEN`, for shop
  mismatch — consistent with reschedule/resize).
- If a "re-open completed appointment" feature is ever wanted, it must be a
  dedicated action that reverses loyalty/QB side-effects — not a relaxation of
  these guards.
