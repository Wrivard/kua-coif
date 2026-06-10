# Plan 021: Migrate Next.js 14.2.35 → 15.5.16+ (security EOL) with the eslint-9 rider

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- package.json next.config.mjs .eslintrc.json middleware.ts`
> Plans 016/019/020 are PREREQUISITES — confirm their status rows are DONE in
> plans/README.md before starting; if not, STOP.

## Status

- **Priority**: P2
- **Effort**: L (multi-day)
- **Risk**: MED — framework major on the auth middleware + public booking;
  mitigations: codemod-driven, e2e safety net (plan 016), staged commits,
  stop-at-15 (NOT 16)
- **Depends on**: 016 (e2e in CI), 019 (next-intl 4), 020 (@supabase/ssr 0.12)
- **Category**: security / migration
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

`pnpm audit --prod` reports 5 HIGH advisories against `next@14.2.35` (RSC
request-deserialization DoS, Server-Components DoS ×2, middleware/proxy
bypass, SSRF) — every advisory's patched range starts at 15.x; **no 14.x
backport exists**, i.e. the 14 line is past its security cutoff while this
app serves an unauthenticated public booking surface and runs all auth
gating in middleware. Staying put means accumulating unpatched highs
indefinitely. Target **15.5.16+** and stop there: 16 additionally removes
`next lint` and defaults to Turbopack against a webpack-coupled Sentry
config — a separate, later decision.

## Current state

(facts verified at `ef34cee`; recount after the prerequisite plans)

- `package.json`: `next: 14.2.35` (pinned), `react/react-dom ^18.3`, `eslint
  ^8.57.1` + `eslint-config-next 14.2.35` (peer caps eslint at 8 — the rider),
  `@next/bundle-analyzer ^16.2.6` (already ahead — align), `@sentry/nextjs ^10`
  (supports 15), `geist ^1.7.1` (pulls a next peer — verify range).
- Async-request-API blast radius (the main codemod surface):
  ~57 page/layout files with `params` props, ~6 with `searchParams`,
  18 `cookies()/headers()` call sites across 17 files (notably
  `lib/supabase/server.ts`, `lib/auth/*`, settings actions, the public
  actions' `clientIp()` copies).
- Caching defaults: the repo is force-dynamic-heavy (79 occurrences / 64
  files) and uses `unstable_cache` at 10 sites (`lib/auth/server.ts`,
  `lib/data/calendar-config.ts` ×4 + plan-017's additions, `lib/data/taxes.ts`,
  `lib/google/sync.ts`) — Next 15's fetch-caching default flip ALIGNS with
  this posture; `unstable_cache` keeps working in 15.
- React 19 required for App Router on 15: peer-green per registry for
  recharts 3.8, @dnd-kit (>=16.8), @testing-library/react 16, @gsap/react,
  next-intl 4. `@react-email/components` is deprecated upstream — should
  still RUN on React 19, but verify at install (it's also plan-target of the
  separately-recorded DEPS-03; do not fix it here).
- `.eslintrc.json` is 9 lines, one custom rule — flat-config conversion is
  trivial. `lint` script = `next lint` (kept on 15; removed only in 16).
- `next.config.mjs` wraps with Sentry (`withSentryConfig`) + next-intl plugin
  + optimizePackageImports list — read fully before starting.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Codemod | `npx @next/codemod@latest upgrade 15` (or `next-async-request-api` individually) | applies cleanly |
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass |
| E2E | `pnpm test:e2e` (via plan 016's env) | green |
| Build | `pnpm build` | exit 0 |
| Audit | `pnpm audit --prod` | 0 high against next |

## Scope

**In scope**:
- `package.json`/lockfile: next 15.5.16+, react/react-dom 19 + @types 19,
  eslint 9 + eslint-config-next 15 + eslint-config-prettier compatible,
  @next/bundle-analyzer aligned, geist bump if its peer requires
- Codemod fallout across `app/`, `lib/` (async `params`/`searchParams`/
  `cookies()`/`headers()`)
- `.eslintrc.json` → `eslint.config.mjs` (port the one custom rule)
- `next.config.mjs` deltas the 15 upgrade guide requires
- `sentry.*.config.ts`/`instrumentation.ts` if @sentry/nextjs's 15 path differs

**Out of scope**:
- Next 16 / Turbopack. Tailwind 4. @react-email replacement (recorded
  separately). Behavioral refactors of caching (force-dynamic stays).
- plan 018's `@vercel/functions` waitUntil → `after()` swap (do it ONLY if
  trivially green, else record as follow-up).

## Git workflow

- Branch: `advisor/021-next-15` — this one should NOT go straight to main;
  PR + CI + e2e green before merge. Staged conventional commits per step.

## Steps

### Step 1: Read the official Next 14→15 upgrade guide; inventory deltas

List each breaking change → applies/doesn't (async request APIs: YES;
caching defaults: aligned; `next/font` legacy: check; runtime config: check;
middleware changes: check against `middleware.ts`'s matcher + widget CSP
logic). Paste the inventory in the report BEFORE changing code.

### Step 2: Bump + codemod

Update the packages; run the codemod(s). Expect mechanical `await params` /
`await cookies()` rewrites. Fix residuals by hand (typed helpers like
`clientIp()` copies in the public actions will surface — keep edits
mechanical).

**Verify**: `pnpm typecheck` → exit 0 (expect to iterate); `pnpm test` → pass.

### Step 3: eslint 9 rider

`eslint.config.mjs` flat config porting `.eslintrc.json`'s content;
bump eslint + eslint-config-next + eslint-config-prettier; keep `next lint`
script (still supported on 15.5).

**Verify**: `pnpm lint` → exit 0 (or only NEW rule noise — triage, don't
mass-disable; report any rule you disable with one line why).

### Step 4: Full verification

**Verify**: `pnpm build` → exit 0 with the placeholder env;
`pnpm test` → all pass; `pnpm test:e2e` (auth + booking + a11y + calendar
via the 016 CI env or locally) → green; `pnpm audit --prod` → no high
advisories on next; smoke the dev server: login, calendar drag, public
booking through the payment step (test mode), widget embed page.

### Step 5: Deploy staging first

Report block for the operator: deploy to a Vercel preview, verify Sentry
events arrive (source maps + tunnel), Stripe webhook still verifies
(signature unaffected, but the route runtime must remain nodejs), crons
respond 200.

## Test plan

The whole existing pyramid is the test plan: 164+ vitest, i18n-parity, RLS
db job, e2e suite (this is why 016 is a prerequisite). New tests: none.

## Done criteria

- [ ] next ≥ 15.5.16, react 19, eslint 9 (versions in report)
- [ ] `pnpm audit --prod` → zero HIGH advisories on next
- [ ] typecheck/test/lint/build/e2e ALL green
- [ ] Inventory (step 1) + rule-disable list (step 3) in the report
- [ ] `plans/README.md` status row updated

## STOP conditions

- Any prerequisite plan not DONE.
- The codemod leaves > ~30 manual errors in non-mechanical shapes (suggests a
  pattern the plan didn't anticipate) — report the pattern first.
- @sentry/nextjs or the next-intl plugin breaks the build on 15 in a way the
  packages' docs don't cover — report versions + error.
- React 19 runtime warnings flood from a specific dependency — report it;
  do not patch dependencies locally.

## Maintenance notes

- Next 16 decision later needs: `next lint` replacement (ESLint CLI) +
  Turbopack-vs-Sentry-webpack evaluation — both recorded here so the 16
  evaluation starts from facts.
- After merge, watch Sentry for hydration/runtime deltas for a week before
  promoting any new caching behavior changes.
