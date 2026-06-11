# Plan 032: Instant feedback — calendar-nav pending state + optimistic status toggles

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` (unless a reviewer told you they maintain the index).
>
> **Drift check (run first)**: `git diff --stat 9e6ce12..HEAD -- "app/[locale]/(app)/appointments-calendar.tsx" "app/[locale]/(app)/services/services-client.tsx" "app/[locale]/(app)/settings/notifications/notifications-client.tsx"`
> If any in-scope file changed, compare the "Current state" excerpts against the
> live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S-M
- **Risk**: LOW (additive pending/optimistic UI with revert-on-error; no data-flow or server change)
- **Depends on**: none. Note 033 (optimistic appointment create/cancel) builds on
  the same calendar file and lands AFTER this. 039 (console safety) also edits
  `notifications-client.tsx` — coordinate (run 032 first or rebase).
- **Category**: perf
- **Planned at**: commit `9e6ce12`, 2026-06-10

## Why this matters

The app already wraps mutations in `useTransition` + loading buttons, but two of
the most-repeated interactions give **no feedback at all**:

1. **Calendar day-paging** is the single most-clicked control in the product, and
   it freezes the UI with zero feedback for the whole server render. `shiftDate`
   /`jumpToday` call `router.push(?date=…)` and the component's one transition
   **discards** `isPending` (`appointments-calendar.tsx:341` `const [, startTransition]`).
   Same-segment searchParams nav does not re-trigger `loading.tsx`, so a "next
   day" click reads as "did my click register?" for ~0.3–1.7s. Switching to Week
   view additionally flashes a **valid-looking but empty** week grid until the
   server responds — momentarily reading as "no bookings this week".
2. **Status toggles** (service enable/disable, notification automations) wait a
   full server round-trip before the switch visually moves — the canonical
   "instant" control feels ignored for ~300–800ms. The optimistic pattern is
   already proven one function away (services drag-reorder is optimistic with
   revert, `services-client.tsx:124-145`).

All fixes are local UI; none touch the server actions or data.

## Current state

- `app/[locale]/(app)/appointments-calendar.tsx:341` — `const [, startTransition] = useTransition();`
  (the `isPending` slot is empty). This transition is reused for reschedule and
  bulk-cancel mutations, so DO NOT just capture its pending — add a SEPARATE one
  for navigation.
- `appointments-calendar.tsx:768-798` — navigation:
  ```ts
  const shiftDate = useCallback((deltaDays) => {
    const next = shopIsoDate(addDays(dayRef, deltaDays), timezone);
    const url = new URL(window.location.href);
    url.searchParams.set('date', next);
    router.push(url.pathname + '?' + url.searchParams.toString());     // ← no transition
  }, [dayRef, timezone, router]);
  const jumpToday = useCallback(() => { /* same shape, ?date=today */ }, [router, today]);
  const changeView = useCallback((next) => {
    setView(next);
    if (next === 'week' || view === 'week') { /* router.push(?view=next) */ }  // ← no pending guard
  }, [router, view]);
  ```
- `appointments-calendar.tsx:851-869` — the prev/Today/next header controls (two
  icon `<button>`s + a `<Button variant="secondary">`). Line 873-882 shows the
  house pattern for a transient inline indicator (`justRefreshed` pill, opacity
  fade, `aria-live`). Reuse that visual grammar for pending.
- There is an existing grid skeleton to reuse: `GridSkeleton` referenced by the
  audit at `appointments-calendar.tsx:75-97` (confirm the symbol name in-file).
- `app/[locale]/(app)/services/services-client.tsx:74-77` — `ordered` local state
  mirrors the `services` prop and re-syncs on prop change (this is the optimistic
  substrate). `:113-122` — `onToggleStatus` awaits `toggleServiceStatus` and does
  **no local flip**; the row's displayed status comes from `ordered`. `:124-145` —
  `onDragEnd` is the optimistic exemplar: snapshot `previous`, `setOrdered(next)`,
  revert on `!result.ok`. Mirror it.
- `app/[locale]/(app)/settings/notifications/notifications-client.tsx:202-209` —
  `onToggle` awaits `toggleAutomation` with no local flip; the switches derive
  `checked` from server props, and `disabled={saving}` greys ALL toggles during
  any one save (per-row pending is missing).

Convention: optimistic-with-revert via a local `useState` synced from props
(`services-client.tsx:74-77`), or React 19 `useOptimistic`. Toasts via
`useToast().show`. Match the existing `tErr(result.errorCode)` error mapping.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass (245) |
| Lint | `pnpm lint` | exit 0 |
| Format | `pnpm format:check` | exit 0 |
| Build | `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key pnpm build` | exit 0 |

## Scope

**In scope**:
- `app/[locale]/(app)/appointments-calendar.tsx` — nav pending (PERF-01) + week-switch guard (PERF-04).
- `app/[locale]/(app)/services/services-client.tsx` — optimistic status toggle (PERF-02).
- `app/[locale]/(app)/settings/notifications/notifications-client.tsx` — optimistic + per-row pending (PERF-02).

**Out of scope**:
- The server actions (`toggleServiceStatus`, `toggleAutomation`, reschedule) — no
  signature or behavior change.
- Optimistic appointment CREATE/CANCEL on the grid — that's plan 033 (it
  generalizes the `overrides` map; do not start it here).
- The drag-reorder transition and any other existing transition.
- `products-client.tsx` status toggle — already shipped its own pattern; leave it.

## Git workflow

- Branch: `advisor/032-instant-feedback`.
- One commit per step; conventional commits, e.g.
  `perf(calendar): pending feedback on day/week navigation`,
  `perf(services): optimistic status toggle`.
- Co-Authored-By footer. Do NOT push unless instructed.

## Steps

### Step 1: Calendar navigation pending feedback (PERF-01)

Add a dedicated nav transition (do not reuse the mutation one):
`const [isNavPending, startNavTransition] = useTransition();`. Wrap the
`router.push(...)` in BOTH `shiftDate` and `jumpToday` in `startNavTransition`.
Then surface pending without blocking:
- Optimistically render the TARGET date in the header subtitle immediately (so the
  date label flips on click, before the server responds), OR show a small spinner
  in the header — pick the simpler given the current `formatHeaderDate(dayRef…)`
  binding; the optimistic-date approach reads best.
- Dim/shimmer the grid while `isNavPending` (e.g. wrap the grid in
  `<div className={cn(isNavPending && 'pointer-events-none opacity-60 transition-opacity')}>`),
  matching the opacity-fade grammar of the `justRefreshed` pill (`:873-882`).

**Verify**: `pnpm typecheck` → exit 0. Dev server: click next/prev — the grid
visibly dims and the header reflects the move immediately; no dead freeze.

### Step 2: Week-view switch guard (PERF-04)

In `changeView`, wrap the `router.push(?view=…)` in `startNavTransition` too, and
while `isNavPending && next === 'week'` render a week-shaped skeleton (reuse
`GridSkeleton`/the week skeleton) OR keep the prior pane visible dimmed — never
show the empty `weekListAppointments` default (`[]`) as if it were data.

**Verify**: dev server, toggle Side-by-side → Week: no flash of an empty week;
a skeleton or dimmed prior content shows until data arrives.

### Step 3: Optimistic service status toggle (PERF-02)

In `services-client.tsx:onToggleStatus`, mirror the drag-reorder pattern: snapshot
`previous = ordered`, optimistically flip the row's `status` in `ordered`
(`setOrdered(ordered.map(s => s.id === row.id ? { ...s, status: flipped } : s))`),
then on `!result.ok` `setOrdered(previous)` + the existing danger toast. The
success toast stays. (The `useEffect` at `:75-77` re-syncs from props after
`revalidatePath`, reconciling any drift.)

**Verify**: `pnpm typecheck` → exit 0. Dev server: toggling a service flips the
row instantly; forcing an error (e.g. offline) reverts it.

### Step 4: Optimistic notification toggle + per-row pending (PERF-02)

In `notifications-client.tsx`, introduce a local optimistic mirror of the
automation rows' `enabled` flags (a `useState` synced from props, like services),
flip the toggled row immediately in `onToggle`, revert on `!result.ok`. Replace
the global `disabled={saving}` on the switches with a per-row pending flag (track
the in-flight row id) so toggling one automation doesn't grey the rest.

**Verify**: `pnpm typecheck` → exit 0. Dev server: a toggle flips instantly and
only that row shows pending; the others stay interactive.

## Test plan

- No new unit tests required (these are local-UI reactivity changes; the server
  actions are unchanged and already covered). If a `services-client` or
  `notifications-client` test exists that asserts post-toggle state, update it to
  the optimistic shape; do not weaken it.
- Manual QA matrix (dev server): calendar next/prev/today/week feedback; service
  toggle instant + revert-on-error; notification toggle instant + per-row pending.
- `pnpm test` → 245 still pass.

## Done criteria

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0 (245)
- [ ] `pnpm lint` + `pnpm format:check` exit 0
- [ ] `pnpm build` exits 0
- [ ] `grep -n "const \[, startTransition\]" app/[locale]/(app)/appointments-calendar.tsx` — the nav now uses a NAMED `isNavPending` transition (the discard pattern is gone for navigation)
- [ ] Manual QA matrix confirmed by the executor
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Capturing `isPending` from the EXISTING transition (instead of adding a separate
  nav one) makes the grid dim during reschedule/bulk-cancel too — if you find
  yourself doing that, STOP and add the dedicated transition instead.
- The optimistic flip causes a flicker/double-render when `revalidatePath` lands
  (the prop re-sync fights the optimistic state) — if the `useEffect` re-sync
  doesn't reconcile cleanly, report rather than disabling the re-sync.
- `GridSkeleton`/week-skeleton symbol isn't where the audit said — search the file;
  if no reusable skeleton exists, a simple dimmed-prior-pane is an acceptable
  fallback (note it in your report).

## Maintenance notes

- **Reviewer**: confirm the nav transition is SEPARATE from the mutation
  transition, and that every optimistic flip has a revert path on `!result.ok`.
- Plan 033 will generalize the calendar `overrides` map for optimistic
  create/cancel — it should reuse the dimming/pending grammar introduced here.
- If a future change makes the calendar page non-`force-dynamic` or adds
  `staleTimes` (audit PERF-06), the perceived freeze shrinks but the pending
  feedback is still correct to keep.
- Deferred: finances range-filter soft-nav and shaped route skeletons are plan 034.
