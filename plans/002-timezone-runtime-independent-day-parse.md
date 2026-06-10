# Plan 002: Make day-window parsing independent of the server runtime timezone

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- lib/business/timezone.ts lib/business/timezone.test.ts .github/workflows/ci.yml`
> On any mismatch with the Current-state excerpts, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (one helper body; behavior unchanged where runtime TZ == shop TZ)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

`parseShopIsoDate` converts a `YYYY-MM-DD` string into "start of that day in
the shop's timezone" — but its current implementation gives the right answer
**only when the server's own TZ matches the shop's timezone**. Vercel
serverless runs `TZ=UTC` by default: there,
`parseShopIsoDate('2026-06-10', 'America/Toronto')` returns
`2026-06-09T04:00:00Z` — the start of **June 9** in Toronto. Its two consumers
are the main calendar day window and the finances/today close-out: in a
UTC-runtime deploy both silently show **yesterday's** appointments/revenue
while the page header shows today. CI never catches it because `ci.yml` pins
`TZ: America/Toronto` for the test run — the pin that makes tests reproducible
also masks this entire bug class.

## Current state

- `lib/business/timezone.ts:92-95` — the bug:

```ts
/** Parse a YYYY-MM-DD into a UTC Date at start-of-day-in-tz. */
export function parseShopIsoDate(iso: string, timezone: string): Date {
  return shopDayStart(parse(iso, 'yyyy-MM-dd', new Date()), timezone);
}
```

`parse(iso, 'yyyy-MM-dd', new Date())` yields a Date at *runtime-local*
midnight of that calendar day. `shopDayStart` (lines 41-46) then treats that
instant as a point in time and converts: `toZonedTime` → `startOfDay` →
`fromZonedTime`. Under `TZ=UTC`, runtime midnight of June 10 is 20:00 June 9
in Toronto, so `startOfDay` snaps to June 9. Double conversion.

- The CORRECT pattern already exists in the same file, `combineShopDateTime`
  (lines 66-76): `parse` the components, then `fromZonedTime(ref, timezone)` —
  `fromZonedTime` reads the Date's *components* (which `parse` set to exactly
  the parsed values regardless of runtime TZ) and reinterprets them as
  shop-local. Runtime-independent.

- Callers (all fixed automatically by fixing the helper — do not modify them):
  - `app/[locale]/(app)/page.tsx:75` (calendar day window), `:90-93`
    (week-window math: `parseShopIsoDate(weekMondayIso, …)` + `shopDayEnd`).
  - `app/[locale]/(app)/finances/today/page.tsx:73` (day close-out window).

- Existing tests: `lib/business/timezone.test.ts` (includes DST cases; uses
  explicit IANA zones + fixed instants).

- CI: `.github/workflows/ci.yml` — the `Test (Vitest)` step sets
  `TZ: America/Toronto` (lines ~45-50).

## Commands you will need

| Purpose   | Command          | Expected on success |
|-----------|------------------|---------------------|
| Typecheck | `pnpm typecheck` | exit 0              |
| Tests     | `pnpm test`      | all pass            |
| One file  | `pnpm vitest run lib/business/timezone.test.ts` | all pass |

## Scope

**In scope**:
- `lib/business/timezone.ts` (the `parseShopIsoDate` body only)
- `lib/business/timezone.test.ts` (new cases)
- `.github/workflows/ci.yml` (one added step)

**Out of scope**:
- The callers (`(app)/page.tsx`, `finances/today/page.tsx`) — no change needed.
- `shopDayStart`/`shopDayEnd` — they take a real instant and are CORRECT for
  that contract; only the string-parsing entry point is wrong.
- `combineShopDateTime` — already correct; you only reuse it.

## Git workflow

- Conventional commit, e.g. `fix(timezone): parseShopIsoDate independent of server runtime TZ`.
- Do NOT push unless instructed.

## Steps

### Step 1: Rewrite `parseShopIsoDate` on top of `combineShopDateTime`

```ts
/** Parse a YYYY-MM-DD into a UTC Date at start-of-day-in-tz.
 *  Runtime-TZ independent: the string is interpreted as a shop-local
 *  wall-clock date (NOT as runtime-local midnight — Vercel runs TZ=UTC). */
export function parseShopIsoDate(iso: string, timezone: string): Date {
  return combineShopDateTime(iso, '00:00', timezone);
}
```

Note: `combineShopDateTime` throws on invalid input where the old code
returned an Invalid Date. Both callers regex-validate or build the ISO string
themselves before calling, so the throw is unreachable in practice — but
confirm by reading `app/[locale]/(app)/page.tsx` around its `isoDate`
derivation and `finances/today/page.tsx:70-72` (it regex-guards
`searchParams.date`). If you find an UNGUARDED caller, STOP.

**Verify**: `pnpm vitest run lib/business/timezone.test.ts` → all existing
tests pass. `pnpm typecheck` → exit 0.

### Step 2: Add regression tests

In `lib/business/timezone.test.ts`, add a `describe('parseShopIsoDate')`:

1. `parseShopIsoDate('2026-06-10','America/Toronto').toISOString()` ===
   `'2026-06-10T04:00:00.000Z'` (EDT, UTC-4).
2. Winter/EST: `parseShopIsoDate('2026-01-10','America/Toronto')` →
   `'2026-01-10T05:00:00.000Z'`.
3. DST spring-forward day: `parseShopIsoDate('2026-03-08','America/Toronto')`
   → `'2026-03-08T05:00:00.000Z'` (midnight is pre-jump, still EST).
4. Equivalence: equals `combineShopDateTime(iso, '00:00', tz)` for a sample date.

These assert absolute instants, so they pass under ANY runtime TZ — which is
exactly what step 3 exploits.

**Verify**: `pnpm vitest run lib/business/timezone.test.ts` → all pass,
including 4 new.

### Step 3: Add a `TZ=UTC` CI leg for the timezone suite

In `.github/workflows/ci.yml`, directly after the existing `Test (Vitest)`
step, add:

```yaml
      - name: Test timezone helpers under UTC runtime
        # The main test run pins TZ=America/Toronto for reproducibility — which
        # also MASKS runtime-TZ bugs (prod serverless runs UTC). This leg
        # re-runs the timezone suite under UTC so a runtime-dependent helper
        # fails loudly here instead of shipping.
        env:
          TZ: UTC
        run: pnpm vitest run lib/business/timezone.test.ts
```

**Verify**: locally simulate it (PowerShell): `$env:TZ='UTC'; pnpm vitest run lib/business/timezone.test.ts; Remove-Item Env:TZ` → all pass.
(Note: Node on Windows honors `$env:TZ` for `Intl`; if you observe it doesn't
on your machine, rely on the CI run and say so in your report.)

### Step 4: Full gates

**Verify**: `pnpm test` → all pass. `pnpm lint` && `pnpm format:check` → exit 0.

## Test plan

Covered in steps 2–3: 4 unit cases (EDT, EST, DST boundary, equivalence) + the
UTC-runtime CI leg that would have caught the original bug.

## Done criteria

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm vitest run lib/business/timezone.test.ts` passes under both the
      default env and `TZ=UTC`
- [ ] `grep -n "combineShopDateTime(iso, '00:00'" lib/business/timezone.ts` → 1 match
- [ ] ci.yml contains the new UTC step (grep `Test timezone helpers under UTC`)
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Any caller of `parseShopIsoDate` feeds it an unvalidated string (the throw
  semantics would then be a behavior change) — report the call site.
- An existing timezone test FAILS after step 1 — that would mean a consumer
  depends on the buggy runtime-relative behavior; report which.
- You are tempted to "fix" `shopDayStart` too — don't; its Date-in/Date-out
  contract is correct.

## Maintenance notes

- Vercel: also worth setting the project env var `TZ=America/Toronto`? NO —
  do not paper over it; multi-shop means per-shop timezones and the code must
  be runtime-independent. The fix here is the real one.
- Future date-string parsing helpers must follow the `combineShopDateTime`
  pattern (components + `fromZonedTime`), never `parse(...)` + instant
  conversion. A reviewer seeing `parse(iso, …, new Date())` near timezone code
  should flag it.
- Plan 016 adds broader CI hardening; its TZ work references this leg.
