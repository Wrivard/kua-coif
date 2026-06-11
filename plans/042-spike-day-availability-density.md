# Plan 042: SPIKE — per-day availability density in the booking + reschedule date strips

> **Executor instructions**: This is a DESIGN/SPIKE plan. The deliverable is a written
> design + a small prototype probe + open questions — NOT a shipped feature. Write the
> output to `plans/042-OUTPUT-day-availability-design.md`. Do not modify product code beyond
> a throwaway measurement probe (revert it). When done, update this plan's row in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 9e6ce12..HEAD -- "app/api/book/[shopSlug]/slots/route.ts" "app/[locale]/book/[shopSlug]/booking-wizard.tsx" "app/[locale]/reschedule/[token]/reschedule-client.tsx" lib/business/availability.ts`

## Status

- **Priority**: P3
- **Effort**: M (spike — investigate + design)
- **Risk**: LOW (design only)
- **Depends on**: complements plans 035 (booking dead-ends) and 037 (reschedule). Best done
  after them so the "false dead end" UX is already fixed and this adds the positive signal.
- **Category**: direction
- **Planned at**: commit `9e6ce12`, 2026-06-10

## Why this matters

Both date strips (booking `DateStrip` `booking-wizard.tsx:1655-1666`, reschedule
`reschedule-client.tsx:73-79`) render 14 equal days that know only `closed`/`dayOff`. A
fully-booked day looks identical to a wide-open one — discoverable only by tapping (one fetch
per tap, against a 30/min rate limit on `/api/book/[shopSlug]/slots`). Customers with flexible
dates linear-scan; competitors (Booksy/Squire) show per-day density. This is the clearest
conversion lever on the booking surface, and it directly defuses the "false dead end" cluster
(closed/empty days). The slots engine already computes everything needed
(`app/api/book/[shopSlug]/slots/route.ts`, `lib/business/availability.ts`) — a day-level
summary is "one loop away" but naively it's 14× the slot computation per strip render, so it
needs a cheap short-circuit + caching. Hence a spike before a build.

## What the spike must produce (`plans/042-OUTPUT-day-availability-design.md`)

1. **Endpoint design**: a summary mode for the slots route, e.g.
   `GET /api/book/[shopSlug]/slots?summary=days&from=<iso>&days=14&barber=<id|any>&duration=<min>`
   returning `{ [iso]: 'open' | 'limited' | 'full' | 'closed' }` (or a count). Specify the
   short-circuit: stop computing a day at its FIRST acceptable slot (don't enumerate all slots)
   to keep it cheap; define the `limited` threshold (e.g. < N slots) if used.
2. **Caching strategy**: TTL (≈60s) keyed by `(shop, barber, duration, day)`; how it composes
   with the existing slots-route Data Cache (plan 017) and the 30/min rate limit (the summary
   call must not blow the limit — one summary request covers the whole strip).
3. **Compute-cost measurement**: add a TEMPORARY probe (revert after) that times the day-summary
   for a real seed shop (14 days, "any" barber) and report worst-case ms. State whether the
   naive approach is acceptable or the short-circuit is mandatory.
4. **UI design** (both strips): dim/badge zero-availability days, dot the available ones, and a
   "Prochaine dispo : jeudi" chip that jumps to the first day with slots. Keep it accessible
   (not color-only — the `closed` state already uses opacity + disabled; add an sr-only label).
5. **Horizon note**: the 14-day strip under-serves shops with a longer `days_book_in_advance`
   (engine supports up to 365, `availability.ts:155`); recommend whether the summary should honor
   the shop's configured horizon.
6. **Open questions + build order**: list the risks (compute blow-up, cache staleness vs a slot
   taken seconds ago, "limited" honesty) and a phased build order (endpoint → booking strip →
   reschedule strip).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck (during probe) | `pnpm typecheck` | exit 0 |
| Read the engine | (read) `lib/business/availability.ts`, `app/api/book/[shopSlug]/slots/route.ts` | understand the slot loop |

## Scope

**In scope**: the OUTPUT design doc; a throwaway timing probe (reverted). Reading the slots
route + availability engine + both date strips.

**Out of scope**: shipping the endpoint or the UI (that's a follow-up build plan the design
defines). No product-code change survives this spike.

## Done criteria

- [ ] `plans/042-OUTPUT-day-availability-design.md` exists with all six sections above
- [ ] The compute-cost section has a REAL measured number (from the reverted probe), not a guess
- [ ] No product code changed (`git status` clean except the OUTPUT doc)
- [ ] `plans/README.md` row updated

## STOP conditions

- The measured worst-case day-summary exceeds ~1s even with the short-circuit — STOP and report;
  the feature may need precomputation (a materialized per-day availability table) rather than
  on-demand, which is a bigger design.

## Maintenance notes

- Pairs with the widget (plan 038) — if shipped, the embed date strip benefits too.
- The "next available" chip is the single highest-value piece; if the full density map is too
  costly, the chip alone (first open day) is a cheap subset worth shipping first.
