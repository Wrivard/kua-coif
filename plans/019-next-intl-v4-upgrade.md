# Plan 019: Upgrade next-intl 3.26 → 4.x (open-redirect fix; decoupled from Next 15)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- i18n.ts middleware.ts "app/[locale]/layout.tsx" next.config.mjs package.json`
> On mismatch with the Current-state excerpts, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (locale routing wraps EVERY route incl. auth redirects — but
  regressions are loud, and the repo is already on v4-shaped APIs)
- **Depends on**: plan 016 (e2e job recommended as safety net; not a hard blocker)
- **Category**: security / migration
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

`pnpm audit` flags next-intl < 4.9.1 with an **open redirect**
(GHSA-8f24-v5vv-gm5j) — no 3.x patch exists. This app routes every request
through `createIntlMiddleware` (`localePrefix: 'always'`), including the
unauthenticated booking pages and the signed customer links (/me, /review,
/receipt, /reschedule) — an open redirect on that origin is a phishing
primitive against salon customers holding legitimate links. next-intl 4
supports Next 14 (peer `^12…^16`), so this lands now, independent of the
Next 15 migration (plan 021), and shrinks that migration's surface.

## Current state

(verified at `ef34cee`)

- `package.json`: `"next-intl": "^3.26.0"`.
- The repo is ALREADY on v4-shaped APIs, which makes this cheap:
  - `i18n.ts:11-13` — `getRequestConfig(async ({ requestLocale }) => { const requested = await requestLocale; … })` (the Promise-based signature v4 requires).
  - Pages use `setRequestLocale` (modern name), ~13 sites.
  - ZERO `next-intl/navigation` usage (grep to confirm).
- `middleware.ts:7-11`:

```ts
const handleI18n = createIntlMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always',
});
```

- ~112 `next-intl` import sites (`useTranslations`/`getTranslations` —
  unchanged in v4).
- Plugin wiring lives in `next.config.mjs` (`createNextIntlPlugin` or
  equivalent — read the file to confirm the exact form and the i18n.ts path
  argument).
- Admin-route i18n handling has a special case around `middleware.ts:236-240`
  (per the audit) — read that block; it must behave identically post-upgrade.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Upgrade | `pnpm add next-intl@^4` | lockfile updated |
| Audit | `pnpm audit --prod` | next-intl advisories GONE |
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass (incl. tests/i18n-parity.test.ts) |
| Build | `pnpm build` (placeholder env) | exit 0 |
| E2E (if 016 landed / local env exists) | `pnpm test:e2e` | green |

## Scope

**In scope**:
- `package.json` + lockfile (next-intl only)
- `i18n.ts`, `middleware.ts`, `app/[locale]/layout.tsx`, `next.config.mjs` —
  ONLY as required by the v4 changelog
- Mechanical renames across consumers ONLY if v4 renamed something the repo
  uses (not expected — verify)

**Out of scope**:
- Next.js version (plan 021). Locale set / message files. Any behavior change
  to PUBLIC_PATH_PREFIXES or auth redirects.

## Git workflow

- Conventional commit: `chore(deps): next-intl 4 (open-redirect fix)`.
- Do NOT push unless instructed.

## Steps

### Step 1: Read the official v4 upgrade guide FIRST

Fetch the next-intl 3→4 migration notes (the package CHANGELOG in
node_modules after install, or next-intl.dev docs). List in your report every
breaking change and mark each as applies/doesn't-apply to this repo (the
expected deltas: `getRequestConfig` return shape — already conformant;
possible rename of the middleware factory import or its options; possible
plugin entry change in next.config.mjs; TypeScript locale typing
augmentation — optional).

### Step 2: Upgrade + adapt

`pnpm add next-intl@^4` (latest 4.x). Apply ONLY the deltas identified in
step 1 to the 4 config files. Do not refactor anything else.

**Verify**: `pnpm typecheck` → exit 0; `pnpm test` → all pass;
`pnpm build` → exit 0.

### Step 3: Audit + behavior pass

**Verify**: `pnpm audit --prod` → no next-intl entries. Manual/e2e behavior
checklist (run e2e if available; otherwise dev-server spot checks, listing
results in the report): `/` → redirects to `/fr`; `/en/book/<slug>` renders
English; login redirect preserves locale; a signed `/fr/me/<token>` link
renders without locale bounce; the `middleware.ts:236-240` admin special-case
still behaves (describe what it does in the report).

## Test plan

- `tests/i18n-parity.test.ts` (runs in `pnpm test`) guards the message files.
- e2e auth/booking specs cover locale routing if plan 016 landed.
- No new tests required — this is a dependency swap with config deltas.

## Done criteria

- [ ] next-intl resolves to ≥ 4.9.1 (`pnpm why next-intl` output in report)
- [ ] `pnpm audit --prod` shows zero next-intl advisories
- [ ] typecheck/test/build green; behavior checklist green
- [ ] Diff limited to package.json, lockfile, and the step-1-listed files
- [ ] `plans/README.md` status row updated

## STOP conditions

- The v4 guide requires restructuring `i18n.ts` into `src/i18n/request.ts`
  or similar AND the plugin can't point at the current path — report the
  layout choice rather than moving files unilaterally.
- Typecheck errors fan out into message-key typing across many consumers
  (v4's stricter types) — report the count before mass-editing.
- Any redirect behavior change observed in step 3 — STOP, this is the
  security surface being fixed, not adjusted.

## Maintenance notes

- After this, plan 021's Next-15 move no longer carries the i18n variable.
- Pin awareness: future next-intl majors gate on Next majors — check peers
  before bumping either side.
