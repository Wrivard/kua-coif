# Plan 040: Calendar journey upgrades — deletable blocks, date jump, appointment deep-link, view URL, one status map

> **Executor instructions**: Follow this plan step by step. Run every verification and
> confirm the expected result before moving on. Steps are independent — a reviewer may
> dispatch them separately. If anything in "STOP conditions" occurs, stop and report.
> When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 9e6ce12..HEAD -- "app/[locale]/(app)/appointments-calendar.tsx" "app/[locale]/(app)/appointments-grid.tsx" "app/[locale]/(app)/appointments-list-view.tsx" "app/[locale]/(app)/page.tsx" "app/[locale]/(app)/actions.ts" "app/[locale]/(app)/clients/[id]/page.tsx"`
> Compare each "Current state" excerpt against the live code; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M-L
- **Risk**: LOW-MED (CAL-03 adds a destructive server action — shop-scope + audit it; the rest are nav/UI)
- **Depends on**: **runs AFTER the calendar reactive/safety plans** — 032 (nav pending), 033
  (optimistic create/cancel), 039 (CAL-01 paid icon) all edit `appointments-calendar.tsx` /
  `appointments-grid.tsx` / `page.tsx`. Sequence this last among the calendar plans (or rebase).
- **Category**: bug / feature
- **Planned at**: commit `9e6ce12`, 2026-06-10

## Why this matters

Five daily-driver friction points on the calendar (the most-used screen):

- **Blocked time is permanent** — the block overlay has no delete/edit
  (`appointments-grid.tsx:293-301` `onClick={stopPropagation}`, no handler), so a barber back
  early, a finished lunch break, or a mis-entered recurring block permanently eats bookable
  inventory; the only fix today is SQL.
- **No direct date jump** — navigation is prev/next/today only; booking "three Thursdays from
  now" is ~21 chevron clicks, each a full server re-render. The `?date=YYYY-MM-DD` contract
  already exists.
- **No appointment deep-link** — three surfaces (disputes, finances/today outstanding, client
  fiche history) dead-end into "go find that appointment by hand" because there's no
  `?appt=<id>` that opens the drawer.
- **List view isn't persisted** in the URL like Week (`appointments-calendar.tsx:788-798` only
  syncs `?view=` for week), so it's lost on reload/share.
- **Three divergent status→visual maps** drift (`appointments-calendar.tsx:~205`,
  `appointments-list-view.tsx:25-39`, `clients/[id]/page.tsx:32-39`) — no_show reads as "needs
  attention" on the grid but "nothing" in the day's List view.

## Current state

- `app/[locale]/(app)/appointments-grid.tsx:293-301` — blocked-time overlay:
  `<div className="border-danger/20 bg-danger/10 … rounded-md …" onClick={(e) => e.stopPropagation()}>… {b.reason ?? t('blocked')}</div>`
  (`b` has `id`, `start_at`, `end_at`, `reason`).
- `app/[locale]/(app)/actions.ts:~1263` (verify) — `blockTime` inserts blocked_time rows (and
  audit-logs entity `blocked_time`). Mirror it for a `deleteBlockedTime` sibling.
- `app/[locale]/(app)/appointments-calendar.tsx:851-869` — the header nav (prev/Today/next).
  `:768-798` — `shiftDate`/`jumpToday` write `?date=`; `changeView` syncs `?view=` ONLY when
  entering/leaving `week`. `page.tsx` reads `?date=` (`:79`) and `?view=` (`:85`).
- `app/[locale]/(app)/appointments-list-view.tsx:25-39` — `statusBadgeVariant` (no_show →
  'default'); `appointments-calendar.tsx:~205` — `statusToColor` (no_show → warning);
  `clients/[id]/page.tsx:32-39` — `STATUS_VARIANT` (confirmed → accent, no_show → warning).

Conventions: server actions via `withAction` (auth + role gate + zod), shop-scoped writes +
`logDurableAudit` for money/compliance trails; the drawer opens from client-side state (a deep
link must resolve the appointment's date server-side then open the drawer on mount). i18n in
`messages/{fr,en}.json`, both required. `ConfirmDialog` for destructive actions.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass (245); i18n-parity green |
| Lint / Format | `pnpm lint` · `pnpm format:check` | exit 0 |
| Build | `… pnpm build` | exit 0 |

## Scope

**In scope**: `appointments-grid.tsx` (clickable block overlay), `app/[locale]/(app)/actions.ts`
(`deleteBlockedTime`), `app/[locale]/(app)/schema.ts` (its zod), `appointments-calendar.tsx`
(date jump + view URL + deep-link drawer open), `app/[locale]/(app)/page.tsx` (resolve `?appt=`),
`appointments-list-view.tsx` + `clients/[id]/page.tsx` (adopt the one shared status map), a new
shared status-map helper (e.g. in `lib/` or a UI helper), `messages/{fr,en}.json`.

**Out of scope** (deferred CONSOLE-JOURNEYS BACKLOG — independent small features, pick up
opportunistically or as a follow-up plan): CAL-02 charge-from-drawer (`chargeAppointment` exists,
unreachable), CAL-05 inline client create in the appointment modal, CLI-02 client-fiche actions
(Edit/Book), SVC-01 services search bar, FIN-01/02/03 (finances close-out nav, commission export,
`<a>`→`Link`). Also out: the actual deep-link CALL SITES in disputes/finances/fiche (this plan
adds the `?appt=` capability; wiring the three links is a small follow-up once it works).

## Git workflow

- Branch: `advisor/040-calendar-journeys`. Commit per step; e.g.
  `feat(calendar): delete blocked time`, `feat(calendar): direct date jump`.
- Co-Authored-By footer. Do NOT push unless instructed.

## Steps

### Step 1: Deletable blocked time (CAL-03)

Add a `deleteBlockedTime({ id })` server action mirroring `blockTime` (same `withAction` role gate,
shop-scoped `.eq('shop_id', activeShopId)`, `logDurableAudit` entity `blocked_time`). Make the
grid block overlay open a small popover / ConfirmDialog with Delete (keep `stopPropagation` so it
doesn't start a slot-create). For recurring sets, offer "this occurrence" now and note
"this and following" as a follow-up if the schema doesn't make it trivial.

**Verify**: dev server: clicking a block offers Delete; confirming removes it and frees the slot;
the audit log records it. `pnpm typecheck` → exit 0.

### Step 2: Direct date jump (CAL-04)

Add a native `<input type="date">` (or a small month popover) to the calendar header that sets
`?date=` (reuse the `shiftDate` URL-writing path; wrap in 032's nav transition if present).
Keyboard-accessible by virtue of the native input.

**Verify**: picking a date jumps there in one action; keyboard works.

### Step 3: Appointment deep-link capability (CAL-07)

Make `page.tsx` accept `?appt=<id>`: resolve that appointment's date server-side and set the
calendar to it (redirect to its `?date=`), and have `AppointmentsCalendar` open the detail drawer
for the matching id on mount. (Wiring the disputes/finances/fiche links is a noted follow-up.)

**Verify**: visiting `/?appt=<valid id>` lands on that appointment's day with its drawer open; an
invalid/foreign id is ignored gracefully (no crash, no cross-tenant leak — the server resolve is
shop-scoped).

### Step 4: Persist the List view in the URL (CAL-09)

In `changeView`, always write `?view=` (use `router.replace` to avoid history spam), keeping
side-by-side as the no-param default — so List round-trips like Week.

**Verify**: choosing List then reloading keeps List; sharing the URL preserves it.

### Step 5: One shared status→visual map (CAL-10)

Extract a single canonical `status → Badge variant` map into a shared helper; import it in
`appointments-list-view.tsx` and `clients/[id]/page.tsx`. Keep `statusToColor` (block FILLS) as the
only calendar-specific variant. Result: no_show (and every status) reads consistently across the
grid, the day list, and the fiche.

**Verify**: a no_show appointment shows the SAME variant in List view and on the fiche as the
grid implies. `pnpm typecheck` → exit 0.

## Test plan

- Add a test for `deleteBlockedTime` (shop-scope + audit) modeled on the `blockTime` test if one
  exists. If a status-map helper test fits, assert each status maps once.
- Manual matrix per step. `pnpm test` → 245 (+ any) pass, i18n-parity green.

## Done criteria

- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm build` exit 0; `pnpm test` exits 0
- [ ] Blocked time is deletable (shop-scoped + audited); the grid block is interactive
- [ ] Header date jump works; List view persists in `?view=`; `?appt=<id>` opens the drawer
- [ ] One status map imported by list-view + fiche; `grep` shows the duplicate maps removed
- [ ] No out-of-scope (backlog) feature added; no cross-tenant leak on `?appt=`
- [ ] `plans/README.md` row updated

## STOP conditions

- `deleteBlockedTime` can't be scoped to the active shop (the blocked_time row lacks `shop_id`) —
  STOP; a destructive action MUST be tenant-scoped.
- The `?appt=` resolve could return another shop's appointment — STOP; it must be shop-scoped
  exactly like every other authed query.
- Unifying the status map changes a DELIBERATE per-surface choice (e.g. the fiche intentionally
  shows confirmed as accent) — confirm the canonical mapping with the reviewer before flattening.

## Maintenance notes

- **Reviewer**: scrutinize Step 1 (destructive, money-adjacent inventory) and Step 3 (cross-tenant
  resolve) for scoping.
- **CONSOLE-JOURNEYS BACKLOG** (deferred here, worth a follow-up plan): CAL-02 charge-from-drawer
  (a fully-built `chargeAppointment` action has zero call sites — the most-repeated salon task,
  finish-and-collect, has no in-console path), CAL-05 inline client create, CLI-02 client-fiche
  Edit/Book actions, SVC-01 services search, FIN-01/02/03 finances nav + commission CSV export.
  Each is small and independent; bundle a "040b console journeys" when ready.
- Once `?appt=` works, wire the three dead-end call sites (disputes "linked", finances/today
  outstanding rows, client fiche history rows) — a small follow-up.
