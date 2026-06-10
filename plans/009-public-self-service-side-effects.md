# Plan 009: Fire the Google-mirror + waitlist side-effects on public self-cancel / public reschedule

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- "app/[locale]/me/[token]/actions.ts" "app/[locale]/reschedule/[token]/actions.ts" "app/[locale]/(app)/actions.ts"`
> On mismatch with the Current-state excerpts, STOP. (Plans 004/007 legitimately
> touched `(app)/actions.ts` and the two public files' audit lines — expected.)

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW-MED (adds best-effort `void` side-effects mirroring the admin paths; the core cancel/reschedule writes are untouched)
- **Depends on**: none (run AFTER 007 to avoid line churn in the same files)
- **Category**: bug
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

When an ADMIN cancels an appointment, three side-effects fire: the mirrored
Google Calendar event is deleted, matching waitlist entries are notified that
a slot opened, and the cancellation email goes out. When the CUSTOMER cancels
via their /me self-service link, only the email fires — the barber keeps a
**ghost event on their personal Google Calendar** (they'll think the slot is
taken, or worse, that the customer is coming), and the waitlist — whose whole
point is filling freed slots — is never notified on exactly the
slot-freeing path that matters most (customers cancelling). Same family:
public reschedule moves `start_at/end_at` in the DB but never pushes the
update to Google, so the barber's calendar shows the OLD time. Verified by
grep: `deleteAppointmentMirror` / `pushAppointment` /
`notifyMatchingWaitlistOnCancel` have ZERO references in
`app/[locale]/me/[token]/actions.ts` and
`app/[locale]/reschedule/[token]/actions.ts`.

## Current state

(all at `ef34cee`)

- **Public self-cancel** — `app/[locale]/me/[token]/actions.ts`,
  `cancelMyAppointment`: refund leg (:336-358), then the cancel write
  (:360-365):

```ts
const updateRes = await supabase
  .from('appointments')
  .update({ status: 'cancelled' })
  .eq('id', appt.id);
if (updateRes.error) return err('UNEXPECTED');
```

  then audit + email. The `appt` row was selected earlier in the function —
  read that select and note whether it includes `google_event_id` and
  `start_at` (you will likely need to ADD `google_event_id`).
- **Public reschedule** — `app/[locale]/reschedule/[token]/actions.ts`
  (:207-223): updates `start_at/end_at`, then audit. The earlier `appt` select
  must expose `google_event_id` + `barber_id` (check; extend if needed).
- **Admin exemplars to mirror** — `app/[locale]/(app)/actions.ts`:
  - cancel → mirror delete (:903-909):

```ts
if (pre?.google_event_id) {
  void deleteAppointmentMirror({
    appointmentId: input.id,
    barberId: pre.barber_id,
    googleEventId: pre.google_event_id,
  });
}
```

  - cancel → waitlist notify (:999-1012 — read it for the exact argument
    shape; grep hit at :1006 `void notifyMatchingWaitlistOnCancel({`).
  - reschedule → Google push: read :545-585 (grep hits: `deleteAppointmentMirror`
    at :556, `pushAppointment` at :561 and :571 — there are two branches,
    likely same-barber update vs barber-change delete+recreate; the public
    reschedule never changes barber, so you need only the same-barber push
    branch).
- Imports in the admin file (line ~30):
  `import { deleteAppointmentMirror, pushAppointment } from '@/lib/google/sync';`
  and (~40) `import { notifyMatchingWaitlistOnCancel } from '@/lib/business/waitlist-notify';`
- Both public files run with the **service-role** client and no session —
  `lib/google/sync.ts` and `lib/business/waitlist-notify.ts` are
  service-role-based and callable from public flows (verify: grep their
  imports — they create their own service-role clients; they must NOT depend
  on `withAction` ctx).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass |
| Lint/format | `pnpm lint` && `pnpm format:check` | exit 0 |

## Scope

**In scope**:
- `app/[locale]/me/[token]/actions.ts` (cancelMyAppointment only)
- `app/[locale]/reschedule/[token]/actions.ts` (the reschedule action only)

**Out of scope**:
- `(app)/actions.ts` (read-only exemplar).
- The email dispatch in both files (already correct).
- QuickBooks sync (only fires on completion — not relevant to cancel/reschedule).
- Waitlist notify on RESCHEDULE (the old slot frees up too — defensible, but
  the admin path doesn't do it either; keep parity, note as follow-up).

## Git workflow

- Conventional commit: `fix(public): google-mirror + waitlist side-effects on self-cancel/reschedule`.
- Do NOT push unless instructed.

## Steps

### Step 1: Extend the row selects

In both files, find the appointment select feeding the action and ensure it
includes `google_event_id`, `barber_id`, `start_at`, `shop_id` (most are
already there; add what's missing + extend the inline cast types).

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Self-cancel — mirror delete + waitlist notify

In `cancelMyAppointment`, AFTER the successful `update({ status:'cancelled' })`
(and after the audit write so failure ordering keeps the trail), add — copying
the admin exemplars' argument shapes EXACTLY:

```ts
if (appt.google_event_id) {
  void deleteAppointmentMirror({
    appointmentId: appt.id,
    barberId: appt.barber_id,
    googleEventId: appt.google_event_id,
  });
}
void notifyMatchingWaitlistOnCancel({ /* copy the exact args from (app)/actions.ts:999-1012 */ });
```

Add the two imports. Both are `void` best-effort — they must not change the
action's return.

**Verify**: `pnpm typecheck` → exit 0;
`grep -n "deleteAppointmentMirror\|notifyMatchingWaitlistOnCancel" "app/[locale]/me/[token]/actions.ts"` → both present.

### Step 3: Public reschedule — Google push

In the reschedule action, after the successful time update, add the
same-barber push (copy the args from the admin reschedule branch at
`(app)/actions.ts` ~:561):

```ts
if (appt.google_event_id) {
  void pushAppointment({ /* exact args from the admin same-barber branch */ });
}
```

Note: the admin branch may push with the NEW times read from its own scope —
make sure you pass the NEW `start_at`/`end_at` (`newStartAt.toISOString()`),
not the stale row values.

**Verify**: `pnpm typecheck` → exit 0;
`grep -n "pushAppointment" "app/[locale]/reschedule/[token]/actions.ts"` → present.

### Step 4: Full gates

**Verify**: `pnpm test` → all pass; `pnpm lint` && `pnpm format:check` → exit 0;
`pnpm build` → exit 0.

## Test plan

- `lib/google/sync.ts` / `waitlist-notify.ts` are already integration-level
  utilities with their own guards; no new unit tests are practical pre-harness.
  Record for plan 015: self-cancel fires mirror-delete + waitlist-notify;
  reschedule fires push with the new times.
- Operator smoke: connect a test barber's Google Calendar, book + self-cancel
  via the /me link → the Google event disappears; reschedule via the public
  link → the Google event moves.

## Done criteria

- [ ] `pnpm typecheck`, `pnpm test`, lint, format, build all exit 0
- [ ] Greps in steps 2–3 pass
- [ ] The added calls are `void`-prefixed (best-effort) and placed after the
      successful DB write
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `deleteAppointmentMirror` / `pushAppointment` / `notifyMatchingWaitlistOnCancel`
  turn out to require a user session or `withAction` ctx (they shouldn't —
  verify their signatures in `lib/google/sync.ts` / `lib/business/waitlist-notify.ts`
  before wiring) — report instead of refactoring them.
- The admin reschedule push branch's argument shape doesn't transfer cleanly
  (e.g. it reads from a schedule object the public path doesn't have) — report
  with the actual shapes.

## Maintenance notes

- Waitlist-notify on public RESCHEDULE (old slot freed) is a deliberate gap —
  admin parity first; revisit with product input.
- If a third cancel surface ever appears, extract a shared
  `afterAppointmentCancelled(appt)` orchestrator — at two copies we stay
  inline; at three, consolidate (same judgment as plan 006's note).
