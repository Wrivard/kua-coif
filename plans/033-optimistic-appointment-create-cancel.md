# Plan 033: Optimistic appointment create + cancel on the calendar grid

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> When done, update this plan's row in `plans/README.md` (unless a reviewer told
> you they maintain the index).
>
> **Drift check (run first)**: `git diff --stat 9e6ce12..HEAD -- "app/[locale]/(app)/appointments-calendar.tsx" "app/[locale]/(app)/appointment-form-modal.tsx" "app/[locale]/(app)/appointment-detail-drawer.tsx"`
> If any in-scope file changed, compare the excerpts below against the live code.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (optimistic INSERT must compose the calendar's appointment shape client-side; a wrong shape flickers on the money surface — Step 2 has explicit STOP rules)
- **Depends on**: **plan 032** (same file `appointments-calendar.tsx`; 032 adds the
  nav pending grammar and lands first). Run AFTER 032.
- **Category**: perf
- **Planned at**: commit `9e6ce12`, 2026-06-10

## Why this matters

Drag-to-move on the calendar is already optimistic (the block jumps instantly, then
realtime delivers truth). But CREATE and CANCEL are not: after "Rendez-vous créé" /
"Annulé", the grid stays unchanged until Supabase Realtime → a 250ms-debounced
`router.refresh()` re-runs the whole `force-dynamic` page (~0.5–1s). On a busy grid
the operator double-checks or re-clicks. Closing the toast-vs-truth gap on the money
surface is the last reactivity gap after 032. The mechanism already exists — the
`overrides` Map + its prune-on-truth effect — and just needs to be generalized from
MOVE to also cover INSERT (phantom block) and REMOVE (hide cancelled).

## Current state

- `app/[locale]/(app)/appointments-calendar.tsx:339-364` — the optimistic substrate:
  ```ts
  const [overrides, setOverrides] = useState<Map<string, ApptOverride>>(new Map());
  // prune-on-truth: when the realtime-refreshed `appointments` prop matches an
  // override (barber_id + start_at + end_at), delete it from the Map.
  ```
- `appointments-calendar.tsx:684-727` — the drag handler is the optimistic EXEMPLAR:
  `setOverrides((prev) => new Map(prev).set(appt.id, override))` immediately, then in a
  transition call the action; on `!result.ok` delete the override (revert) + toast; on
  success leave it (realtime prunes). `effectiveAppointments` (the render source) is
  `appointments` with `overrides` applied.
- `app/[locale]/(app)/appointment-form-modal.tsx:135-145` — `onSubmit`: `createAppointment(values)`;
  on `ok` → success toast + `onClose()`. **No optimistic insert.** The modal has the
  form `values` (barberId, date/time, serviceIds, client) needed to compose a provisional
  block; it's rendered by the calendar (which can pass a callback).
- `app/[locale]/(app)/appointment-detail-drawer.tsx:136` — `onCancel(...)`: calls the
  cancel action; on success → toast + `onClose()`. **No optimistic hide** — the cancelled
  block lingers until the realtime refresh.
- The calendar renders `CalendarAppointment` objects; inspect that type in
  `appointments-calendar.tsx` (it carries id, barber_id, start_at, end_at, status,
  client name, services, payment_status, source) — the phantom must satisfy it.

Convention: optimistic state is a React `useState` reconciled by a prune-on-truth
effect against the realtime-refreshed `appointments` prop; revert on `!result.ok` with
a toast. Match the drag handler's shape exactly.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass (245) |
| Lint | `pnpm lint` | exit 0 |
| Format | `pnpm format:check` | exit 0 |
| Build | `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key pnpm build` | exit 0 |

## Scope

**In scope**: `appointments-calendar.tsx` (the optimistic layer + callbacks),
`appointment-form-modal.tsx` (call an `onCreated` callback), `appointment-detail-drawer.tsx`
(call an `onCancelled` callback).

**Out of scope**:
- The server actions (`createAppointment`, `cancelAppointment`) — no signature change.
  If `createAppointment` does not already return the new id, do NOT change it; prune the
  phantom by shape match (barber_id + start_at) instead.
- Bulk-cancel (already shows a server-counted toast), drag-move/resize (already optimistic).
- The nav pending work (plan 032).

## Git workflow

- Branch: `advisor/033-optimistic-appointment-create-cancel`.
- Commits: `perf(calendar): optimistic cancel (hide on confirm)` then
  `perf(calendar): optimistic create (phantom block)`.
- Co-Authored-By footer. Do NOT push unless instructed.

## Steps

### Step 1: Optimistic CANCEL (low risk — do this first)

Add a `hiddenIds` set (`useState<Set<string>>`) to the calendar. Filter it out of
`effectiveAppointments` (the render source). Pass an `onCancelled(id)` callback to the
detail drawer; the drawer calls it on a successful cancel (right where it currently
toasts + `onClose()`). Prune `hiddenIds` in the existing prune-on-truth effect: drop an
id once the realtime-refreshed `appointments` shows it `cancelled` OR no longer present.
On the (rare) cancel failure path, do NOT add to `hiddenIds` (the drawer only calls the
callback on success).

**Verify**: `pnpm typecheck` → exit 0. Dev server: cancelling from the drawer removes
the block immediately; it does not reappear after the realtime refresh.

### Step 2: Optimistic CREATE (higher risk — STOP rules apply)

Add an `optimisticInserts` list (`useState<CalendarAppointment[]>`) merged into
`effectiveAppointments`. Pass an `onCreated(provisional)` callback to the form modal.
In the modal's `onSubmit` success branch, compose a provisional `CalendarAppointment`
from the form `values` + any returned id (client name/services come from the form's
selected options the modal already holds) and call `onCreated(provisional)` BEFORE
`onClose()`. The calendar appends it. Prune in the prune-on-truth effect by SHAPE match
(barber_id + start_at + duration) — so it works whether or not the action returns an id —
removing the phantom once the real row arrives via realtime. Give the phantom a visual
"pending" affordance (e.g. reduced opacity) until pruned, reusing 032's dimming grammar.

**Verify**: dev server: creating an appointment shows the block instantly (pending
style), which resolves to the real block on the realtime refresh with no duplicate and
no flicker.

## Test plan

- No new unit tests (client optimistic state; the actions are unchanged + covered).
  If a calendar RTL test exists, add: cancel → block hidden; create → phantom present.
- Manual matrix: cancel hides instantly + no reappear; create shows phantom + resolves
  to real with no dup; a forced create/cancel ERROR reverts cleanly (no orphan phantom).
- `pnpm test` → 245 pass.

## Done criteria

- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm format:check` exit 0
- [ ] `pnpm build` exits 0
- [ ] `pnpm test` exits 0 (245)
- [ ] Cancel hides the block immediately and prunes correctly (manual)
- [ ] Create shows a pending phantom that resolves to the real block with no duplicate (manual)
- [ ] No server action signature changed (`git diff` on `actions.ts` is empty)
- [ ] No out-of-scope file modified (`git status`)
- [ ] `plans/README.md` row updated

## STOP conditions

- The phantom's `CalendarAppointment` shape can't be composed faithfully from the form
  values (e.g. layout needs a field the modal doesn't have) and the block renders
  visibly wrong or duplicates after the realtime refresh — STOP after Step 1, report,
  and ship cancel-only (the low-risk half) rather than a flickering create.
- Pruning by shape removes the WRONG block (two appointments share barber+start) — STOP;
  the prune key needs the id, which means a server change is required (escalate, don't
  force it).
- The realtime refresh is slower than expected and the phantom lingers >2s — acceptable
  if it still prunes; if it never prunes, STOP (the prune key is mismatched).

## Maintenance notes

- **Reviewer**: confirm both optimistic paths prune on truth (no unbounded growth) and
  revert/clean up on error; verify a created phantom can't survive a failed insert.
- This composes with 032's dimming grammar — reuse it for the pending phantom, don't
  invent a second style.
- If the calendar later drops `force-dynamic` / adds realtime-less rendering, the
  prune-on-truth effect's trigger (`appointments` prop change) must still fire.
