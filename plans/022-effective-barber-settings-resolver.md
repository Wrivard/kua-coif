# Plan 022: One effective-barber-settings resolver (B20) — 7 drifted copies → 1 tested function

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- lib/business "app/[locale]/book/[shopSlug]/actions.ts" "app/api/book/[shopSlug]/slots/route.ts" "app/[locale]/reschedule/[token]/actions.ts" "app/[locale]/me/[token]/actions.ts" "app/[locale]/(app)/actions.ts" app/api/cron/notifications/route.ts "app/[locale]/(app)/settings/barbers/barber-settings-client.tsx"`
> Plans 001/004/007/008/009/012/014/017/018 touched several of these files —
> EXPECTED. Re-locate each site by its content pattern (the `scope === 'barber'`
> find-pair), not by line number.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (unifying the drifted fallbacks is a deliberate, small
  BEHAVIOR ALIGNMENT on cancel-policy paths — the chosen semantics are pinned
  below and in tests)
- **Depends on**: 001, 009, 017 (same files — land them first)
- **Category**: tech-debt
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

The "effective barber settings" resolution (per-barber override row → shop
default row → fallback) is copy-pasted at SEVEN sites — and the copies have
already drifted: "no settings row" yields a `null` settings object on the
booking path (engine skips those constraints), `minsBefore ?? 0` on the
cancel paths, a hardcoded 24h/1h on the reminders cron, and
`customer_cancellations !== false` (default-allow) only on the /me path. The
same shop can therefore enforce DIFFERENT policy depending on which door the
request came through. Every future settings change costs 7 coordinated edits.
One pure, unit-tested resolver in `lib/business/` ends both problems.

## Current state

The seven sites (verified at `ef34cee`; re-locate by pattern):

| # | Site | Today's variant |
|---|---|---|
| 1 | `app/[locale]/book/[shopSlug]/actions.ts:423-427` | `barberOverride ?? shopDefault ?? null` → engine gets `null` |
| 2 | `app/api/book/[shopSlug]/slots/route.ts:151-154` | same find-pair; `interval = settings?.client_booking_interval_min ?? 30` |
| 3 | `app/[locale]/reschedule/[token]/actions.ts:174-177` | `find(barber) ?? find(shop) ?? null` |
| 4 | `app/[locale]/me/[token]/actions.ts:311-321` | resolution + `minsBefore ?? 0` + `customer_cancellations !== false` |
| 5 | `app/[locale]/(app)/actions.ts:802-814` (cancelAppointment policy gate) | `override ?? fallback`, `minsBefore ?? 0`, ignores customer_cancellations (admin — correct) |
| 6 | `app/api/cron/notifications/route.ts:116-153` | Map per barber + hardcoded `FALLBACK {24h, 1h}` |
| 7 | `app/[locale]/(app)/settings/barbers/barber-settings-client.tsx:60-83` | editor drafts via the same find-pair + `DEFAULTS` const |

- A half-model already exists: `lib/business/reminders.ts` defines
  `ReminderOffsets` + per-barber Map fallback semantics (tested).
- `lib/business/availability.ts:171-176` holds the pure
  `customer_cancellations` rule partially reused by the cancel paths.

PINNED UNIFIED SEMANTICS (the deliberate alignment — encode in the resolver
and its tests; deviations are bugs):

- override row (scope='barber', barber_id match) wins field-by-field? NO —
  ROW-LEVEL precedence (whole override row replaces the shop row), exactly as
  every current site does. Field-level merging would be a behavior change —
  do not introduce it.
- No rows at all → DEFAULTS: `client_booking_interval_min: 30`,
  `barber_booking_interval_min: 15`, `days_book_in_advance: 30`,
  `mins_book_before_appt: 5`, `mins_cancel_before_appt: 0` (no policy),
  `customer_cancellations: true`, `allow_multiple_services: true`,
  reminder offsets 24h/1h, booking/confirmation tip flags as the editor's
  `DEFAULTS` const declares (read it and mirror — the seed annexe is the
  source). These defaults MATCH today's effective behavior on every path
  except site 1/3's `null` (engine-skip) — and THAT is the alignment: a shop
  with no settings rows gets the documented defaults instead of "no
  constraints". State this in the PR description.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| New tests | `pnpm vitest run lib/business/barber-settings.test.ts` | all pass |
| Full | `pnpm test` && `pnpm typecheck` && `pnpm build` | green |

## Scope

**In scope**:
- NEW `lib/business/barber-settings.ts` + `lib/business/barber-settings.test.ts`
- The 7 sites (swap resolution; keep each site's FIELD USAGE unchanged)

**Out of scope**:
- The DB schema, the editor's save path (`save_barber_settings` RPC), the
  matrix UI beyond its draft-building call.
- Changing WHICH fields each consumer reads.
- The reminders cron's dueReminders engine (it already consumes a resolved
  Map — the resolver FEEDS it).

## Git workflow

- Conventional commits, one per consumer group:
  `refactor(settings): shared effective-barber-settings resolver (B20)` then
  `refactor(booking|cancel|cron): consume the resolver`. Do NOT push unless
  instructed.

## Steps

### Step 1: The resolver + tests (no consumer change)

```ts
// lib/business/barber-settings.ts
export type BarberSettingsRow = { scope: 'shop' | 'barber'; barber_id: string | null; /* …the union of consumed columns, all optional except scope/barber_id */ };
export type EffectiveBarberSettings = { /* every consumed field, non-nullable, defaulted */ };
export const BARBER_SETTINGS_DEFAULTS: EffectiveBarberSettings = { /* pinned table above */ };
export function resolveEffectiveBarberSettings(
  rows: ReadonlyArray<BarberSettingsRow>,
  barberId: string | null,
): EffectiveBarberSettings { /* override row ?? shop row ?? DEFAULTS; row-level; missing fields on the chosen row fall to DEFAULTS field-wise */ }
```

Note the one nuance: a chosen row with a NULL column (e.g. legacy row without
`customer_cancellations`) falls back FIELD-WISE to defaults — this matches
site 4's `!== false` semantics. Tests (≥ 8): override beats shop; shop when
no override; defaults when no rows; null-field fallback; barberId null (any-
barber → shop row); reminder offsets mapping equals the cron's current
override→shop→24h/1h behavior; `mins_cancel_before_appt: 0` ⇒ "no policy";
multiple barber rows pick the matching one only.

**Verify**: new test file green; `pnpm typecheck` → exit 0.

### Step 2: Swap the server sites (1–6), one commit each

At each site: keep the EXISTING query (columns may stay narrow — widen the
resolver input type, not the queries), call the resolver, and adapt the local
reads. Sites 1/3: pass the resolved object's fields to `checkAvailability`'s
`settings` param (now never null — the engine's null-skip branch becomes
unreachable from these callers; do NOT remove it from the engine). Site 5:
admin path keeps ignoring `customer_cancellations` (admin override by
design — one comment). Site 6: build the cron's `Map<barberId,
ReminderOffsets>` from the resolver output; delete the local FALLBACK const.

**Verify after EACH site**: `pnpm typecheck` && `pnpm test` green;
behavior-sensitive greps: `grep -rn "scope === 'barber' && r.barber_id" app | measure`
shrinks by one per swap (final: only the editor site 7 remains, then 0 after step 3).

### Step 3: The editor (site 7)

`barber-settings-client.tsx` builds DRAFTS (a different concern — it needs
"row or template", not "effective policy"). Replace only its `DEFAULTS`
literal with `BARBER_SETTINGS_DEFAULTS` (single source for the default
VALUES); keep its row-finding inline (drafting ≠ resolving). If the shapes
fight (client component importing the lib const — it's pure data, fine),
note it.

**Verify**: `pnpm typecheck`; `pnpm build`.

### Step 4: Gates

**Verify**: full `pnpm test`, lint, format, build → green.

## Test plan

Step 1's ≥ 8 resolver tests + the existing `reminders.test.ts` (must stay
green — its offsets semantics are now FED by the resolver at the cron site).
Plan 015 suites (if landed) must stay green — they pin the cancel-policy
behavior.

## Done criteria

- [ ] `lib/business/barber-settings.ts` pure (no supabase import), tested
- [ ] `grep -rn "scope === 'shop'" app | measure` → only the editor's
      draft-builder remains (state the final count + file)
- [ ] The cron's hardcoded FALLBACK const is gone
- [ ] typecheck/test/lint/format/build all green
- [ ] PR description states the one behavior alignment (no-rows ⇒ defaults
      instead of engine-skip on booking/reschedule)
- [ ] `plans/README.md` status row updated

## STOP conditions

- A site consumes a column the resolver type doesn't model — extend the type,
  but if the column has NO sane default (can't be invented), report.
- Any existing test fails after a swap — the drift you hit is load-bearing;
  report which site + which assertion before choosing semantics.
- Tempted to also consolidate the 4× availability data-LOADING pipeline —
  explicitly deferred (plans/README "considered and rejected": DEBT-03 gated
  on plan 015).

## Maintenance notes

- New consumers of barber_settings MUST go through the resolver — reviewer
  rule.
- The slots route consumes `getCachedBarberSettings` rows (plan 017) — the
  resolver composes with the cache (rows in, policy out).
- Field-level vs row-level precedence is now DOCUMENTED behavior; if product
  ever wants field-level merging, it's one function + its tests.
