# Plan 005: Scope /finances and /finances/today queries to the active shop

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- "app/[locale]/(app)/finances/page.tsx" "app/[locale]/(app)/finances/today/page.tsx"`
> On mismatch with the Current-state excerpts, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (additive `.eq` filters; single-shop users see identical data)
- **Depends on**: none (plan 008 touches the same files — run 005 FIRST)
- **Category**: bug
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

The finances pages query `appointments` and `clients` through the
**RLS user client with no `shop_id` filter**. RLS (`is_shop_member`) spans
EVERY shop the user belongs to — so for a multi-shop owner, /finances sums
revenue, commissions and loyalty liability across ALL their shops while the
page header and timezone claim the active shop. Wrong money numbers, silently.
The repo already fixed this exact class twice: the calendar page (June 7
blocker fix) and `finances/disputes/page.tsx`, whose comment says it
verbatim — "`.eq('shop_id', shop.id)` adds current-shop scoping for
multi-shop". The two remaining finances pages never got the same filter.

## Current state

- `app/[locale]/(app)/finances/page.tsx` (at `ef34cee`) — `shop` comes from
  `getCurrentShop()` (:44-47, active-shop-cookie aware). The unscoped reads
  (:63-71):

```ts
const [apptsRes, clientsRes] = await Promise.all([
  supabase
    .from('appointments')
    .select('id, barber_id, total_amount, status, start_at')
    .eq('status', 'completed')
    .gte('start_at', rangeStart.toISOString())
    .lt('start_at', rangeEnd.toISOString()),
  supabase.from('clients').select('id, loyalty_balance_cents').gt('loyalty_balance_cents', 0),
]);
```

  Downstream queries key off the ids these return (barber names,
  appointment_services, commission_tiers) — scoping the two roots scopes the
  page. Check the rest of the file for any OTHER `.from(` without `shop_id`
  before declaring done (commission_tiers query: verify whether it filters
  `shop_id` — if not, add it too).
- `app/[locale]/(app)/finances/today/page.tsx` — drawer query IS scoped
  (`.eq('id', shop.id)`, :84). The appointments read is NOT (:86-93):

```ts
supabase
  .from('appointments')
  .select('id, barber_id, client_id, total_amount, status, payment_status, tip_amount_cents, source, start_at, end_at')
  .gte('start_at', dayStart.toISOString())
  .lt('start_at', dayEnd.toISOString())
  .order('start_at', { ascending: true }),
```

  The two name lookups (:173-180) are id-keyed from that result — fixed
  transitively.
- The exemplar: `app/[locale]/(app)/finances/disputes/page.tsx:49-56`
  (comment + `.eq('shop_id', shop?.id)`).
- Both pages guard `manager+` already (`requireRoleInCurrentShop('manager')`)
  and read `shop` via `getCurrentShop()`; `shop` is nullable in the type.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass |
| Lint/format | `pnpm lint` && `pnpm format:check` | exit 0 |

## Scope

**In scope**:
- `app/[locale]/(app)/finances/page.tsx`
- `app/[locale]/(app)/finances/today/page.tsx`

**Out of scope**:
- `finances/disputes/page.tsx` (already scoped).
- Aggregation/limit changes (plan 008 owns the unbounded-sum problem — do NOT
  add `.limit()` here; it would change behavior without the aggregate rework).
- Any other page's scoping.

## Git workflow

- Conventional commit: `fix(finances): scope queries to the active shop (multi-shop merge)`.
- Do NOT push unless instructed.

## Steps

### Step 1: Null-guard the shop id

Both pages already have `shop` in scope. Where `shop?.id` could be undefined,
follow the file's existing idiom (disputes uses `shop?.id` directly in `.eq`,
which sends `undefined` → matches nothing — acceptable but silent). Prefer an
explicit early guard consistent with the calendar page's fix: if
`!shop?.id`, render the page's empty state (or `notFound()` — match what
`(app)/page.tsx` does post-blocker-fix; read its guard and copy the idiom).

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Add the filter on /finances

Add `.eq('shop_id', shop.id)` to BOTH queries in the `Promise.all` (:63-71).
Then sweep the remainder of the file:
`grep -n "\.from('" "app/[locale]/(app)/finances/page.tsx"` and for each
query, confirm it is either id-keyed off already-scoped results or carries
`.eq('shop_id', …)` — add the filter where it's neither (commission_tiers is
the likely case).

**Verify**: `pnpm typecheck` → exit 0;
`grep -c "eq('shop_id'" "app/[locale]/(app)/finances/page.tsx"` ≥ 2.

### Step 3: Add the filter on /finances/today

Add `.eq('shop_id', shop.id)` to the appointments query (:86-93). Sweep the
file the same way (the barbers/clients `.in()` lookups are transitively scoped
— leave them).

**Verify**: `grep -c "eq('shop_id'" "app/[locale]/(app)/finances/today/page.tsx"` ≥ 1
(plus the existing `.eq('id', shop.id)` drawer query). `pnpm typecheck` → exit 0.

### Step 4: Full gates

**Verify**: `pnpm test` → all pass; `pnpm lint` && `pnpm format:check` → exit 0;
`pnpm build` → exit 0.

## Test plan

- No page-level harness exists; the durable regression lands with plan 015/016
  (an RLS-level cross-shop read test already exists in
  `supabase/tests/rls_cross_shop.sql` but cannot catch THIS class — the rows
  legitimately belong to the user; the bug is active-shop attribution).
- Manual smoke (operator, has a multi-shop account): switch active shop →
  /finances totals change to that shop only; a single-shop account sees
  unchanged numbers.

## Done criteria

- [ ] `pnpm typecheck` exits 0; `pnpm test` exits 0; build green
- [ ] Every `.from('appointments')` / `.from('clients')` /
      `.from('commission_tiers')` in the two files carries `.eq('shop_id', …)`
      or is id-keyed from a scoped result (state which, per query, in the report)
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The Promise.all shapes don't match the excerpts (drift).
- You find the commission/category queries are keyed on something other than
  scoped ids AND adding `shop_id` changes the join semantics — report the
  query instead of restructuring it (008 restructures).
- `shop` turns out to be non-null-guaranteed by an upstream helper — fine,
  note it and skip step 1's guard rather than inventing redirects.

## Maintenance notes

- Rule for reviewers, now enforced 3 times in this repo's history: **every
  RLS-client query on a shop-scoped table in a page MUST carry
  `.eq('shop_id', activeShopId)`** — RLS is the safety net for membership, not
  for active-shop attribution.
- Plan 008 will rework these same queries into bounded aggregates — it rebases
  on this filter.
