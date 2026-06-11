# Plan 034: Shaped route skeletons, settings rail persistence, finances soft-nav, parallel reads

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> When done, update this plan's row in `plans/README.md` (unless a reviewer told
> you they maintain the index).
>
> **Drift check (run first)**: `git diff --stat 9e6ce12..HEAD -- "app/[locale]/(app)/finances/page.tsx" "app/[locale]/(app)/clients/[id]/page.tsx" "app/[locale]/(app)/loading.tsx" "app/[locale]/(app)/products/loading.tsx"`
> If any in-scope file changed, compare the excerpts below against the live code.

## Status

- **Priority**: P2
- **Effort**: S-M
- **Risk**: LOW (new fallback files are additive; the finances soft-nav keeps the page a server component; the parallel reads are independent queries)
- **Depends on**: none. **Shares files with other plans** — `finances/page.tsx` (plans
  039/040) and `clients/[id]/page.tsx` (plan 040). Run 034 FIRST (it's small/additive)
  and have 039/040 rebase, OR sequence after them. Do NOT run in parallel on those two files.
- **Category**: perf
- **Planned at**: commit `9e6ce12`, 2026-06-10

## Why this matters

Two perceived-speed gaps and a free latency win:

- **Wrong-shape skeletons**: only `/products` has a layout-shaped `loading.tsx`
  (`products/loading.tsx` — the documented model). Every other route falls back to the
  generic `(app)/loading.tsx` (a header band + one tall card). The worst case is
  **settings**: it has no `settings/loading.tsx`, so suspension bubbles to the `(app)`
  boundary and the persistent settings sub-rail VANISHES on every one of the 16 settings
  pages — each click feels like a full app reload. Token pages (opened from SMS) stream
  behind the desktop-app-shaped `[locale]/loading.tsx`, then re-arrange.
- **Finances range filter is a native GET form** (`finances/page.tsx:364` `<form method="get">`)
  → a full document reload (re-download, re-hydrate, theme re-init, sidebar remount) just
  to change the date range, bypassing the skeleton system entirely.
- **Serial awaits**: `clients/[id]/page.tsx` awaits the client row, then the appointment
  history — but the history query keys only on `id`+`shopId`, not the client row, so it
  can run in parallel.

## Current state

- `app/[locale]/(app)/products/loading.tsx` — the SHAPED model: a `h-header-h` header
  band with search + add placeholders, a stat strip, then `<Skeleton className="h-[480px] w-full" />`.
  Copy this structure, reshaped per page.
- `app/[locale]/(app)/loading.tsx` — the generic shell fallback (header band + one card);
  its own comment says per-page skeletons were "overkill for a polish pass" — this plan
  adds them for the few HEAVY routes only. Leave this file as the catch-all.
- `app/[locale]/(app)/settings/layout.tsx:36` — hosts the persistent `SettingsSidebar`;
  with no `settings/loading.tsx`, suspension unmounts it. A `settings/loading.tsx`
  renders a PANE-only skeleton while the layout keeps the rail.
- `app/[locale]/(app)/finances/page.tsx:361-415` — the date-range filter:
  ```tsx
  <form method="get" className="…">
    <input id="start" name="start" type="date" defaultValue={rangeStartIso} … />
    <input id="end" name="end" type="date" defaultValue={rangeEndIso} … />
    <Button type="submit" size="sm">{t('rangeForm.apply')}</Button>
    {!isDefaultRange ? <a href="?">{t('rangeForm.thisMonth')}</a> : null}
  </form>
  ```
  Submitting/`href="?"` triggers a full document load.
- `app/[locale]/(app)/clients/[id]/page.tsx:68-112` — `await clientRes` (client row) →
  (barber-ownership probe `await own` when `viewerRole==='barber'`) → `await apptRes`
  (history, keyed on `id`+`shopId`). The three are independent.
- `components/ui/skeleton.tsx` — the `Skeleton` primitive. Token pages are under
  `app/[locale]/<surface>/[token]/` (single-column mobile cards).

Convention: `loading.tsx` is a default-exported server component returning a skeleton
shaped like the route. Server components read `searchParams`; a soft nav uses
`router.push` inside a `useTransition` from a small `'use client'` child.

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
- NEW: `app/[locale]/(app)/settings/loading.tsx`, `app/[locale]/(app)/finances/loading.tsx`,
  `app/[locale]/(app)/clients/loading.tsx`, and a shaped `loading.tsx` for the four token
  routes (`me|receipt|review|reschedule/[token]/loading.tsx` — a centered card skeleton).
- NEW: `app/[locale]/(app)/finances/date-range-filter.tsx` (client soft-nav component).
- EDIT: `app/[locale]/(app)/finances/page.tsx` (use the new filter component).
- EDIT: `app/[locale]/(app)/clients/[id]/page.tsx` (`Promise.all` the independent reads).

**Out of scope**:
- The generic `(app)/loading.tsx` — leave it as the catch-all.
- A calendar-ROOT bespoke skeleton: the calendar is `(app)/page.tsx`, whose segment
  loading IS the shared `(app)/loading.tsx`; reshaping it would change every fallback.
  Deferred (note in Maintenance) — 032's nav-pending work covers the calendar feel.
- `clients/page.tsx` count+fetch and `winback/page.tsx` roster+RPC parallelization
  (other PERF-07 sites) — deferred to their owning plans (040/041) to stay file-disjoint.
- Any finances/clients BEHAVIOR change beyond nav mechanics + read parallelism.

## Git workflow

- Branch: `advisor/034-shaped-skeletons-soft-nav`. Commits per step, e.g.
  `perf(settings): pane-only loading skeleton (rail persists)`.
- Co-Authored-By footer. Do NOT push unless instructed.

## Steps

### Step 1: settings/loading.tsx (the biggest win)

Create `settings/loading.tsx` returning a PANE-only skeleton (NOT a full shell — the
`settings/layout.tsx` rail must stay mounted): a title band + a few form-row skeletons
matching the typical settings pane. Verify the rail does NOT disappear on a settings→
settings navigation.

**Verify**: `pnpm build` → exit 0. Dev server: navigating between two settings pages
keeps the sub-rail; only the pane shows a skeleton.

### Step 2: Shaped loading.tsx for finances + clients + token routes

- `finances/loading.tsx`: a KPI hero strip + a chart-block skeleton + a table band.
- `clients/loading.tsx`: an A–Z bar skeleton + a table band.
- `me|receipt|review|reschedule/[token]/loading.tsx`: a centered `max-w-lg/2xl` card
  skeleton (single column), matching the token pages' real shape — NOT the admin grid.

Model each on `products/loading.tsx`'s structure (header band where applicable + shaped
body). Token routes have no app header, so center a card on `min-h-screen`.

**Verify**: `pnpm build` → exit 0. Dev server (throttled): each route fills in with a
shaped skeleton, not the generic card.

### Step 3: Finances range filter → soft navigation (PERF-08)

Create `finances/date-range-filter.tsx` (`'use client'`): renders the two `type="date"`
inputs + Apply + the reset link, and on Apply/reset calls
`router.push(\`?start=${start}&end=${end}\`)` (reset → `router.push('?')`) inside a
`useTransition`, showing pending on the Apply button. Replace the `<form method="get">`
block in `finances/page.tsx` with `<DateRangeFilter rangeStartIso={…} rangeEndIso={…} isDefaultRange={…} />`.
The page stays a server component reading `searchParams` exactly as today.

**Verify**: dev server: changing the range updates the page WITHOUT a full reload (no
white flash; the shell/sidebar stay); the URL still carries `?start&end` and is shareable.

### Step 4: Parallel reads on the client fiche (PERF-07)

In `clients/[id]/page.tsx`, run the independent queries together:
`const [clientRes, apptRes] = await Promise.all([clientQ, apptsQ]);` (+ the barber
ownership probe in parallel when `viewerRole==='barber'`). Apply the `notFound()` checks
AFTER the await, preserving the exact ordering/semantics (no client → notFound; barber
without an own appointment → notFound). Discard `apptRes` implicitly if the client 404s.

**Verify**: `pnpm typecheck` → exit 0; the fiche renders identically (same data, same
404 behavior), one fewer sequential round-trip.

## Test plan

- No new unit tests (route fallbacks + nav mechanics). Manual: settings rail persists;
  shaped skeletons per route; finances range = soft nav; client fiche unchanged + 404
  paths intact (bad id, barber viewing a non-own client).
- `pnpm test` → 245 pass.

## Done criteria

- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm format:check` exit 0
- [ ] `pnpm build` exits 0; `pnpm test` exits 0 (245)
- [ ] `settings/loading.tsx`, `finances/loading.tsx`, `clients/loading.tsx`, and four
      token-route `loading.tsx` files exist
- [ ] Settings rail persists across settings navigations (manual)
- [ ] Finances range change is a soft nav (no full reload) (manual)
- [ ] `clients/[id]/page.tsx` uses `Promise.all`; 404 paths unchanged
- [ ] No out-of-scope file modified (`git status`)
- [ ] `plans/README.md` row updated

## STOP conditions

- A `settings/loading.tsx` causes the RAIL to unmount anyway (suspension boundary higher
  than expected) — verify in dev tools; if the rail still vanishes, report the layout
  nesting rather than guessing.
- The finances soft-nav drops a `searchParams` value the server page needs (e.g. a
  filter beyond start/end) — STOP; preserve every existing query param.
- Parallelizing the client fiche reads changes the 404 behavior for the barber-ownership
  case — STOP; the ownership gate's `notFound()` must remain authoritative.

## Maintenance notes

- **Reviewer**: confirm the finances page stays a server component (the filter is a thin
  client leaf) and that no skeleton claims data it doesn't have.
- **Deferred**: a calendar-root bespoke skeleton (blocked by the shared `(app)/loading.tsx`
  fallback — would need a route-group restructure); the other PERF-07 sites
  (`clients/page.tsx`, `winback/page.tsx`) fold into plans 040/041.
- If `finances/page.tsx` later gains more filters, extend the client filter component to
  carry them rather than reverting to a GET form.
