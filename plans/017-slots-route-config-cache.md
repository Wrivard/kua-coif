# Plan 017: Cache the slow-changing config on the public slots route (B14) + per-shop public revalidation

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- "app/api/book/[shopSlug]/slots/route.ts" lib/data/calendar-config.ts lib/server-actions/revalidate.ts`
> On mismatch with the Current-state excerpts, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (stale-config windows on a public money-adjacent surface — every
  cached read MUST have its tag busted by the action that mutates it; the
  booking ACTION's own reads stay live, so a stale slot can never become a
  wrong booking — the action re-validates everything)
- **Depends on**: none. Conflicts: plan 022 touches the same route — 017 first.
- **Category**: perf
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

`/api/book/[shopSlug]/slots` is the hottest public endpoint: the booking
wizard refires it on EVERY date or barber change. Each call makes ~8
round-trips (rate-limit Redis + shop-by-alias + barber validation + a 5-query
`Promise.all`), of which 5–6 hit data that changes weekly (shop row, barber
bookability, `shop_hours`, `shop_days_off`, `barber_settings`) — only
appointments + blocked_time are genuinely volatile. The per-shop
`unstable_cache` exemplar already exists (`lib/data/calendar-config.ts`,
shop-scoped tags + `revalidateShopConfig`) and `getCachedShopHours` /
`getCachedShopDaysOff` are ALREADY BUILT — the slots route just doesn't use
them. Related half: `revalidatePublicShopSurfaces()` purges the /book + /embed
ISR of EVERY tenant on any one shop's edit (route-pattern form) — fix the
granularity while adding the new tags.

## Current state

- `app/api/book/[shopSlug]/slots/route.ts` (read in full at `ef34cee`):
  shop-by-alias (:42-52, uncached), barber validation per call (:56-79), the
  5-query batch (:85-109) including `shop_hours` / `shop_days_off` /
  `barber_settings` alongside live appointments + blocked_time. Settings
  resolution at :151-154 (`interval = settings?.client_booking_interval_min ?? 30`).
  Returns `cache-control: no-store` (:195-198 — correct, keep: the RESPONSE
  must stay fresh; it's the upstream CONFIG reads we cache).
- `lib/data/calendar-config.ts` — the exemplar: service-role reads wrapped in
  `unstable_cache` with per-shop tags (`${tag}:${shopId}`), 300s TTL,
  `shopConfigCacheTags(shopId)` enumerates them, busted by
  `revalidateShopConfig(shopId)` (`lib/server-actions/revalidate.ts:51-53`).
  `getCachedShopHours(shopId)` + `getCachedShopDaysOff(shopId)` exist there.
- `lib/server-actions/revalidate.ts:22-25`:

```ts
export function revalidatePublicShopSurfaces() {
  revalidatePath('/[locale]/book/[shopSlug]', 'page');
  revalidatePath('/[locale]/embed/[shopSlug]', 'page');
}
```

  — every-tenant purge by design ("no need to look up the shop alias").
- Mutating actions that must bust the new caches: barbers CRUD + bookable
  toggle (`app/[locale]/(app)/barbers/actions.ts`), `save_barber_settings`
  action (`app/[locale]/(app)/settings/barbers/actions.ts`), shop hours/days-off
  (settings/shop), shop alias/payment fields (settings/shop). Enumerate their
  existing revalidate calls with
  `grep -rn "revalidatePublicShopSurfaces\|revalidateShopConfig" app`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass |
| Build | `pnpm build` (placeholder env) | exit 0 |

## Scope

**In scope**:
- `lib/data/calendar-config.ts` — add `getCachedShopByAlias`,
  `getCachedBarberSettings(shopId)`, `getCachedBookableBarbers(shopId)`
  (same idiom; new tags registered in `shopConfigCacheTags`)
- `app/api/book/[shopSlug]/slots/route.ts` — consume the cached loaders
- `lib/server-actions/revalidate.ts` — per-shop public-surface revalidation
- The mutating actions' revalidate calls (alias-aware)

**Out of scope**:
- `bookPublicAppointment` — its reads stay LIVE (money path; the
  re-validation there is the correctness backstop that makes this plan safe).
- The /book page's own queries (already behind 60s ISR).
- Appointments/blocked_time reads anywhere (volatile by nature).

## Git workflow

- Conventional commit: `perf(booking): cached config on the slots route + per-shop public revalidation`.
- Do NOT push unless instructed.

## Steps

### Step 1: New cached loaders

In `lib/data/calendar-config.ts`, following the existing functions exactly
(service-role client, `unstable_cache`, 300s, per-shop tag):

- `getCachedShopByAlias(alias)` → the slots route's shop projection
  (`id, timezone, allow_booking_any_barber`). Tag: `shop-alias:${alias}`
  (alias-keyed — note it in `shopConfigCacheTags`? NO: that helper is
  shopId-keyed; export a separate `shopAliasCacheTag(alias)` and document
  that alias-affecting mutations must bust it).
- `getCachedBarberSettings(shopId)` → the settings columns the route reads.
  Tag: `barber-settings:${shopId}` — ADD it to `shopConfigCacheTags`.
- `getCachedBookableBarbers(shopId)` → `id, sort_order` of
  confirmed+bookable barbers. Tag: `bookable-barbers:${shopId}` — add to
  `shopConfigCacheTags`.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Consume in the slots route

Replace: shop-by-alias → `getCachedShopByAlias`; the barber-'any' branch →
pick first from `getCachedBookableBarbers(shop.id)`; the explicit-barber
validation → check membership in that same cached list (`.some(b => b.id ===
barber)`) instead of a per-call query; `shop_hours` → `getCachedShopHours`;
`shop_days_off` → `getCachedShopDaysOff`; `barber_settings` →
`getCachedBarberSettings`. The `Promise.all` shrinks to the two live queries
(appointments, blocked_time) alongside the cached loader promises. Keep the
response `no-store` header and ALL availability semantics identical.

**Verify**: `pnpm typecheck` → exit 0; route diff shows only data-sourcing
changes (no engine-input changes — diff the `checkAvailability` argument
construction: byte-identical).

### Step 3: Per-shop public revalidation

In `revalidate.ts`, change the signature to
`revalidatePublicShopSurfaces(shopAlias?: string)`: with an alias, revalidate
`/fr/book/${alias}` + `/en/book/${alias}` + the two embed equivalents
(literal paths) AND `revalidateTag(shopAliasCacheTag(alias))`; without an
alias (caller can't know it), keep the old global route-pattern purge as the
fallback. Update each caller: most actions have `ctx.shopId` but not the
alias — add a tiny cached alias lookup or pass it where the action already
loads the shop row; where impractical, call the no-arg fallback and leave a
`// global purge — alias not in reach` comment. `save_barber_settings` +
barbers CRUD must ALSO call `revalidateShopConfig(ctx.shopId)` now (it busts
the two new shopId tags).

**Verify**: `grep -rn "revalidatePublicShopSurfaces(" app lib` — every caller
compiles; callers passing an alias listed in your report.

### Step 4: Gates

**Verify**: `pnpm test` → all pass; `pnpm build` → exit 0; `pnpm lint` &&
`pnpm format:check` → exit 0.

## Test plan

- Record for plan 015's backlog: slots-route test with fixtures (cached
  loaders mocked) asserting the grid for a known day.
- Operator smoke: toggle a barber's `bookable` off → within one save, the
  booking wizard stops offering them (the action's revalidation busts the
  tag); edit hours → slots reflect immediately.

## Done criteria

- [ ] Slots route runs exactly 2 live DB queries per call (appointments,
      blocked_time) — paste the final `Promise.all` in the report
- [ ] 3 new cached loaders with per-shop/alias tags; `shopConfigCacheTags`
      extended; mutating actions bust them
- [ ] `revalidatePublicShopSurfaces` is alias-aware with a documented fallback
- [ ] `pnpm typecheck`, `pnpm test`, build, lint, format all green
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `unstable_cache` keys/tags can't express the alias-keyed shop lookup
  cleanly (key must include the alias argument — the exemplar's pattern
  handles args; if it doesn't compose, report).
- You find a mutation path that changes bookability/hours WITHOUT a server
  action (e.g. direct SQL in a migration) — note it; runtime TTL (300s) is
  the accepted staleness bound for those.
- Tempted to also cache inside `bookPublicAppointment` — HARD out of scope.

## Maintenance notes

- The 300s TTL is the safety net for any missed bust; correctness is never at
  stake (the booking action re-validates live).
- Plan 022 will swap the settings RESOLUTION here for the shared resolver —
  it consumes `getCachedBarberSettings`'s rows unchanged.
- If shops ever get custom domains, the alias tag scheme extends naturally.
