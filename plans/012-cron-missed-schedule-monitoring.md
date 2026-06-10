# Plan 012: Missed-schedule monitoring for the business crons (Sentry check-ins)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- app/api/cron lib/observability.ts`
> (Plan 008 legitimately modified `app/api/cron/notifications/route.ts` and
> `app/api/cron/birthday-greetings/route.ts` — expected; anything else, STOP.)

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (additive observability; check-in failures must never affect the cron's work)
- **Depends on**: 008 (same files — land it first to avoid churn)
- **Category**: dx / reliability
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

The revenue-protecting crons (15-min appointment reminders, hourly Stripe
reconcile, daily birthdays) run on GitHub Actions schedules; two more
(quickbooks-refresh, google-channel-renew) run on Vercel crons. Today the
ONLY failure signal is a run that executes and errors (in-route Sentry).
A run that **never happens** — expired `CRON_SECRET`, changed `APP_URL`
secret, runner outage, or GitHub's silent auto-disable of scheduled workflows
after 60 days without repo activity — produces zero signal. The operator
finds out when a shop owner complains that clients stopped getting reminders.
Sentry Cron Monitors alert on the MISSED schedule, which is the half that's
currently invisible.

## Current state

- The 5 cron routes, all `GET` handlers behind `isCronAuthorized`
  (`lib/security/cron-auth.ts`):
  - `app/api/cron/notifications/route.ts` — every 15 min
    (`.github/workflows/cron-notifications.yml`)
  - `app/api/cron/stripe-reconcile/route.ts` — hourly
    (`cron-stripe-reconcile.yml`)
  - `app/api/cron/birthday-greetings/route.ts` — daily
    (`cron-birthday-greetings.yml`)
  - `app/api/cron/quickbooks-refresh/route.ts` — daily 02:15 (vercel.json)
  - `app/api/cron/google-channel-renew/route.ts` — daily 02:30 (vercel.json)
- Sentry is initialized via `@sentry/nextjs` v10 (sentry.server.config.ts,
  instrumentation.ts); `lib/observability.ts` wraps captureException.
- @sentry/nextjs v8+ ships `Sentry.captureCheckIn(...)` and
  `Sentry.withMonitor(slug, fn, monitorConfig)` — **verify availability first**:
  `grep -rn "captureCheckIn\|withMonitor" node_modules/@sentry/nextjs/build/types 2>$null`
  (or consult the installed package's .d.ts). If absent in v10's export
  surface, STOP and report (the API may have moved to `Sentry.monitor`).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass |
| Lint/format | `pnpm lint` && `pnpm format:check` | exit 0 |

## Scope

**In scope**:
- `lib/observability.ts` (one new helper)
- The 5 cron route files (wrap each handler body)

**Out of scope**:
- The GitHub workflow files (no change needed — the check-in is in-route, so a
  workflow that never fires simply never checks in = the alert).
- Sentry dashboard monitor creation — `monitorConfig` (upsert) handles it in
  code; include the 5 slugs + schedules in your report so the operator can
  confirm alert rules.
- Slack notification fan-out (Sentry alert rules cover routing).

## Git workflow

- Conventional commit: `feat(observability): sentry cron check-ins on the 5 business crons`.
- Do NOT push unless instructed.

## Steps

### Step 1: Add a `withCronMonitor` helper

In `lib/observability.ts`, add and export:

```ts
import * as Sentry from '@sentry/nextjs';

/** Wrap a cron route's work in a Sentry Cron Monitor check-in pair.
 *  Best-effort: monitoring must never break the cron itself. */
export async function withCronMonitor<T>(
  slug: string,
  schedule: { type: 'crontab'; value: string },
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await Sentry.withMonitor(slug, fn, {
      schedule,
      checkinMargin: 10, // minutes of lateness tolerated before "missed"
      maxRuntime: 5,
      timezone: 'UTC',
    });
  } catch (e) {
    // If withMonitor itself is unavailable/throws synchronously, fall back to
    // running the work unmonitored rather than failing the cron.
    if (typeof (Sentry as Record<string, unknown>).withMonitor !== 'function') {
      return await fn();
    }
    throw e;
  }
}
```

Adjust to the ACTUAL v10 API discovered in the verify-first grep (the shape
above matches v8/v9 docs; if v10 differs, follow the installed types — the
plan's intent is one helper, five wrapped routes).

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Wrap the 5 routes

In each cron route, after the `isCronAuthorized` gate, wrap the remaining
handler body:

| Route | slug | crontab |
|---|---|---|
| notifications | `cron-notifications` | `*/15 * * * *` |
| stripe-reconcile | `cron-stripe-reconcile` | `0 * * * *` |
| birthday-greetings | `cron-birthday-greetings` | (copy from its workflow file) |
| quickbooks-refresh | `cron-quickbooks-refresh` | `15 2 * * *` |
| google-channel-renew | `cron-google-channel-renew` | `30 2 * * *` |

Read each workflow/vercel.json schedule and use EXACTLY that crontab (a wrong
schedule = false "missed" alerts). Keep the wrap INSIDE the auth gate so
unauthorized probes don't emit check-ins.

**Verify**: `pnpm typecheck` → exit 0;
`grep -rn "withCronMonitor" app/api/cron` → 5 matches.

### Step 3: Full gates + operator block

**Verify**: `pnpm test`, `pnpm lint`, `pnpm format:check`, `pnpm build` → all
exit 0. Report: the 5 slugs + schedules; operator should add a Sentry alert
rule "cron monitor missed/failed → email/Slack" and confirm monitors appear
after the first real runs.

## Test plan

- Not unit-testable (external service). Machine gates above; first scheduled
  runs validate end-to-end (monitors auto-create via upsert).

## Done criteria

- [ ] `pnpm typecheck`, `pnpm test`, lint, format, build all exit 0
- [ ] 5 routes wrapped (grep), helper exported once
- [ ] Crontabs in code match the workflow/vercel.json schedules (paste both in the report)
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The installed @sentry/nextjs v10 exposes neither `withMonitor` nor
  `captureCheckIn` — report the actual export surface instead of guessing.
- Wrapping a route requires restructuring its early-returns substantially —
  report the route; do not refactor its logic.

## Maintenance notes

- GitHub's 60-day auto-disable of scheduled workflows remains — the monitor
  now CATCHES it (missed check-ins) instead of preventing it. If the repo goes
  dormant by design someday, move the 3 Actions crons to a scheduler that
  doesn't expire.
- New crons must ship with a check-in wrap from day one.
