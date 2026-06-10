# Plan 016: CI verification hardening — DB job (migrations + RLS test + types drift), TZ matrix, e2e job, toolchain pinning

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- .github/workflows/ci.yml vitest.config.ts playwright.config.ts tests/e2e package.json pnpm-lock.yaml`
> Plan 002 added a UTC step to ci.yml — expected. Anything else unexplained: STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (new CI jobs are a flake surface — every new job lands
  NON-blocking first, promoted to required only after a week of green)
- **Depends on**: 002 (its UTC leg is here extended)
- **Category**: dx / tests
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

CI today = typecheck + vitest + lint + format + build. It does NOT run: the
cross-tenant RLS regression suite (`supabase/tests/rls_cross_shop.sql` — the
guard for the product's #1 stated risk — runs NOWHERE), any migration-apply
check (a broken migration is discovered against prod), any `db/types.ts`
drift check (staleness is what bred the `as any` epidemic), or a single
Playwright spec (4 exist; zero run anywhere; the only authenticated one
self-corrupts its seed fixture by design). Local `pnpm test` runs in whatever
TZ the machine has — while CI pins America/Toronto, which MASKS runtime-TZ
bugs (the plan-002 class). And the toolchain is unpinned: lockfile is
pnpm-8-format (`lockfileVersion: '6.0'`) while CI uses pnpm 9, no
`packageManager`/`engines` anywhere, and the autofix workflow builds on Node
20 vs CI's Node 22.

## Current state

- `.github/workflows/ci.yml` — single job; pnpm 9 / Node 22; `TZ:
  America/Toronto` on the vitest step; placeholder Supabase env for build.
  (Read it in full first.)
- `vitest.config.ts:12-29` — jsdom, globals, include `**/*.test.{ts,tsx}`,
  excludes node_modules/.next/.oryon/.claude. No TZ control.
- `tests/e2e/`: `a11y.spec.ts`, `auth.spec.ts`, `booking.spec.ts` (stops
  BEFORE the Confirm step by design), `calendar.spec.ts` — gated on
  `PLAYWRIGHT_USER_EMAIL/PASSWORD` (:15-31), navigates the SEED date
  2026-05-22, drags "Jules Lethor" from 08:15 (asserts `toContainText('08:15')`
  at :71) to 08:30 and never restores → **a second run against the same DB
  fails**. `playwright.config.ts` reads `.env.local` + `process.env.CI` —
  read it before step 4.
- `package.json` — no `packageManager`, no `engines`. `pnpm-lock.yaml:1` —
  `lockfileVersion: '6.0'`.
- DB assets: `supabase/migrations` (56+), `supabase/seed.sql`,
  `supabase/tests/rls_cross_shop.sql`, scripts `db:reset` / `db:test` /
  `db:types:local` (package.json:18-26). GitHub ubuntu-latest runners have
  Docker → `npx supabase start` works.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck/tests/lint | `pnpm typecheck` && `pnpm test` && `pnpm lint` | green |
| Local supabase (if Docker) | `pnpm db:start` / `pnpm db:reset` / `pnpm db:test` | apply + pass |
| Lockfile regen | `pnpm install` (after packageManager pin) | lockfileVersion 9.0 |

## Scope

**In scope**:
- `.github/workflows/ci.yml` (extend) — or a new `.github/workflows/db-e2e.yml`
  if job separation is cleaner (your call; document it)
- `vitest.config.ts` (comment only — see step 3)
- `tests/e2e/calendar.spec.ts` (fresh-DB gating for the drag test)
- `package.json` (`packageManager`, `engines`) + `pnpm-lock.yaml` (one
  deliberate regen commit)
- `.github/workflows/sentry-autofix.yml` (Node 20 → 22 alignment, one line)

**Out of scope**:
- Writing new e2e specs (the booking Confirm-step e2e becomes possible after
  this lands — record as follow-up).
- Coverage ratchet enforcement (artifact only, optional step 6).
- Branch-protection settings (operator; include in report).

## Git workflow

- One commit per step. `ci(...)`/`chore(...)` scopes. Do NOT push unless
  instructed (note: CI changes only prove themselves on push — say so in the
  report and let the operator push).

## Steps

### Step 1: Toolchain pinning

`package.json`: add `"packageManager": "pnpm@9.15.0"` (or the current 9.x —
state which) and `"engines": { "node": ">=22" }`. Then ONE dedicated commit:
run `pnpm install` and commit the regenerated lockfile (expect
`lockfileVersion: '9.0'`; the diff is large — that is the point of isolating
it). Align `sentry-autofix.yml`'s `node-version` to 22.

**Verify**: `Get-Content pnpm-lock.yaml -TotalCount 1` → `lockfileVersion: '9.0'`;
`pnpm install --frozen-lockfile` → exit 0; `pnpm test` → green.

### Step 2: DB job — migrations + RLS suite + types drift

New job `db` (needs: nothing; parallel to `ci`), `runs-on: ubuntu-latest`,
non-blocking first (`continue-on-error: true` + a tracking comment with the
promotion criterion: 7 consecutive green days):

```yaml
  db:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    continue-on-error: true   # promote to required after a week green
    steps:
      - checkout / pnpm 9 / node 22 / pnpm install (copy the ci job's steps)
      - run: npx --yes supabase start
      - run: npx --yes supabase db reset        # applies ALL migrations + seed.sql
      - run: npx --yes supabase test db         # rls_cross_shop.sql
      - name: Types drift gate
        run: |
          npx --yes supabase gen types typescript --local > /tmp/types.gen.ts
          diff -q /tmp/types.gen.ts db/types.ts || {
            echo '::error::db/types.ts is stale — run pnpm db:types:local (or :remote) and commit'; exit 1; }
```

Caveat to handle: the committed `db/types.ts` was generated from the LINKED
project (`--linked`) — local generation can differ cosmetically (ordering,
version headers). FIRST run the two generators' output diff locally if Docker
is available; if cosmetic diffs exist, normalize (strip the header line) in
the gate script instead of failing on noise. If you cannot verify locally,
ship the gate as REPORT-ONLY (`|| echo ::warning::…`) and note it.

**Verify**: YAML parses (push-time); locally `pnpm db:reset && pnpm db:test`
if Docker available, else mark "validated on first CI run" in the report.

### Step 3: TZ matrix on vitest

Extend plan 002's approach: in ci.yml, add a second FULL vitest run under
`TZ: UTC` (non-blocking first). If the full suite turns out TZ-fragile,
narrow it to `lib/business` and file the fragile tests in your report instead
of fixing them here. Add a comment in `vitest.config.ts` stating the policy:
"tests must pass under any runtime TZ; CI runs Toronto + UTC legs."

**Verify**: locally `$env:TZ='UTC'; pnpm test; Remove-Item Env:TZ` → record
pass/fail; green = blocking-eligible.

### Step 4: e2e job

New job `e2e` (after `db`-style provisioning in the SAME job — supabase
start + db reset): build the app with the LOCAL supabase env (`supabase
status` prints the anon key + URL; export as NEXT_PUBLIC_*), seed a CI login:
add `supabase/seed-ci-user.sql` creating an auth user
(`ci-e2e@kua.test` / a throwaway password via `auth.users` insert or the
supabase CLI admin API — follow the DEPLOY.md `shop_members` one-liner for
membership) and run `npx playwright install chromium --with-deps`, then
`pnpm test:e2e` with `PLAYWRIGHT_USER_EMAIL/PASSWORD` + `E2E_FRESH_DB=1` env.
Set `webServer` per `playwright.config.ts` conventions (read it — it likely
already starts `pnpm dev` or expects a URL; adapt, don't fight it).

In `tests/e2e/calendar.spec.ts`, gate the DRAG test (not the whole file) on
the fresh-DB flag so it stops corrupting persistent local DBs:

```ts
test.skip(!process.env.E2E_FRESH_DB, 'drag test mutates the seed — run only against a fresh db (CI resets per run)');
```

**Verify**: spec edit compiles (`pnpm typecheck`); job YAML parses; full
validation on first CI run (state it).

### Step 5: Wire i18n-parity + report

i18n parity already runs (vitest glob) — no action; CONFIRM by
`pnpm vitest run tests/i18n-parity.test.ts` and note it in the report so
nobody re-adds it.

### Step 6 (optional): coverage artifact

Add `@vitest/coverage-v8` devDependency + a report-only CI step uploading
`coverage/` as an artifact. Skip if step 1's lockfile churn is already large —
note the decision.

## Test plan

The plan IS test infrastructure; its own verification = the listed local
checks + first CI run. The promotion-to-blocking criterion (7 green days) is
the guard against flake-入 CI.

## Done criteria

- [ ] `packageManager` + `engines` set; lockfile regenerated in its own commit; autofix workflow on Node 22
- [ ] `db` job exists (reset + db:test + types-drift gate) — non-blocking with promotion note
- [ ] TZ=UTC vitest leg exists; local UTC run result recorded
- [ ] `e2e` job exists; calendar drag test gated on `E2E_FRESH_DB`
- [ ] `pnpm install --frozen-lockfile && pnpm test && pnpm typecheck && pnpm lint` all green locally
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated; report includes operator items (push to validate, branch-protection update once promoted)

## STOP conditions

- `supabase start` requires auth/config not present in the repo (it
  shouldn't — config.toml exists under supabase/) — report.
- The local-vs-linked types generation differs STRUCTURALLY (not just
  headers) — the drift gate would always fail; ship report-only and flag.
- playwright.config.ts's server model conflicts with the CI job design —
  adapt the job to the config, never the reverse without reporting.

## Maintenance notes

- After 7 green days: remove `continue-on-error`, add `db` + `e2e` to branch
  protection's required checks (operator).
- The booking e2e can now safely click Confirm against the disposable DB —
  highest-value follow-up spec (record only).
- Plans 019/020/021 (upgrades) assume THIS plan's e2e job as their safety
  net — land it first.
