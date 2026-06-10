# Plan 025: Small-debt sweep — shared clientIp/appUrl/phone-key helpers, translated confirms, drop the dead table

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- lib/utils.ts lib/security lib/env "app/[locale]" supabase/migrations`
> Several earlier plans touched these areas — re-locate every site by pattern
> (the greps below), never by line number.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW (mechanical substitutions, each with a grep gate)
- **Depends on**: run AFTER 001–022 to avoid churn (it touches many of the same files trivially)
- **Category**: tech-debt
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

Five micro-duplications, each one divergence away from a real bug: (1)
`clientIp()` pasted 6× verbatim + ~5 inline variants that DROPPED the
`x-real-ip` fallback — IP-keyed rate limits behave differently per endpoint;
(2) `appUrl()` is the "single source of truth" for the customer-link base URL
with a Sentry alarm when unset — bypassed by ~7 hand-rolled
`process.env.NEXT_PUBLIC_APP_URL?.replace(...)` reads whose links break
SILENTLY (including the CASL unsubscribe URL builder); (3) the
phone-dedup/loyalty key (`replace(/\D/g,'').slice(-10)`) is inlined 7× with
its critical 11-digit rationale living in one comment; (4) two destructive
`window.confirm` prompts are hardcoded ENGLISH in a bilingual product (the
repo's converged pattern is ConfirmDialog + next-intl); (5) the
`notification_prefs` table is fully dead (zero readers/writers — superseded
by `notification_automations`) yet sits in the schema misleading every reader.

## Current state

(re-verify each with the greps; verified at `ef34cee`)

- `clientIp` copies: `grep -rn "function clientIp(" app lib` → 6
  (`lib/auth/actions.ts:36`, book/actions.ts:126, me:35, reschedule:31,
  review:33, unsubscribe:31). Inline variants missing `x-real-ip`:
  slots route :21, `app/api/widget/event/route.ts`, the 3 (auth) password
  actions — `grep -rn "x-forwarded-for" app lib` to enumerate.
- `appUrl()` bypasses: `grep -rn "process.env.NEXT_PUBLIC_APP_URL" app lib`
  excluding `lib/env/app-url.ts` and tests → `lib/google/sync.ts:290`,
  `lib/sms/webhook.ts:32`, `lib/business/waitlist-notify.ts:118`,
  `lib/email/unsubscribe.ts:27`, `lib/business/review-request.ts`,
  marketing review-campaign + winback actions.
  ⚠ NUANCE: `lib/sms/webhook.ts` RETURNS NULL when unset (tested behavior —
  `lib/sms/webhook.test.ts:114-117`); `appUrl()` returns `''`. Adapt the call
  site (`const base = appUrl(); if (!base) return null;`) — do NOT change
  webhook.ts's null contract or its tests.
- Phone key: `grep -rn "slice(-10)" app lib` → clients/actions.ts:32,
  clients-client.tsx ×3, book/actions.ts ×3 (one with the explanatory
  comment ~:1381-1383). `lib/utils.ts` exports only the FORMATTER
  (`formatPhoneNANP`).
- English confirms: `app/[locale]/(app)/settings/reviews/reviews-client.tsx:55`
  (`window.confirm('Delete this review permanently?')`),
  `settings/two-factor/two-factor-client.tsx:119` (`'Disable this two-factor
  method?'`). Converged pattern: `ConfirmDialog` (16 importers — copy a
  recent consumer, e.g. the barbers disconnect confirm).
  `settings/waiting-list/waiting-list-client.tsx:92` is a native confirm but
  TRANSLATED — convert it too for consistency (cheap while here).
- Dead table: `notification_prefs` — `grep -rn "notification_prefs" app lib`
  → zero hits (only migrations/seed/types). Created in `20260523000001..3`,
  seeded in seed.sql.
- Locale coercion ×8: `grep -rn "=== 'en' ? 'en' : 'fr'" app lib` —
  birthday/notifications crons, stripe webhook ×2, (app)/actions.ts,
  review-campaign, winback, review-request.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck/tests | `pnpm typecheck` && `pnpm test` | green |
| i18n parity | `pnpm vitest run tests/i18n-parity.test.ts` | pass |
| Build | `pnpm build` | exit 0 |

## Scope

**In scope**: `lib/security/client-ip.ts` (new), `lib/utils.ts` (or
`lib/business/phone.ts`) for `normalizePhoneKey`, `lib/i18n-locale.ts` (or
similar) for `shopLocale`, the call sites enumerated above, the 3 confirm
dialogs + their i18n keys, ONE migration dropping `notification_prefs` (+
remove its seed block), `supabase/seed.sql`.

**Out of scope**: a `withPublicTokenAction` wrapper (the bigger preamble
consolidation — deferred with DEBT-05's note; this plan only extracts the IP
helper), any rate-limit POLICY change, `lib/sms/webhook.ts`'s contract.

## Git workflow

- One commit per item (a–f). Conventional scopes. Do NOT push unless instructed.

## Steps

### a) `getClientIp()` — `lib/security/client-ip.ts`

Extract the 3-line canonical body (x-forwarded-for first hop → x-real-ip →
'unknown') from `lib/auth/actions.ts:36`; swap the 6 copies AND the inline
variants (slots route takes `req.headers` not `headers()` — give the helper
two entry points or accept a `Headers` param; keep it trivial).
**Verify**: `grep -rn "function clientIp(" app lib` → 0;
`grep -rn "x-forwarded-for" app lib` → only inside the new helper (+ any
infra file you deliberately left — list them).

### b) `appUrl()` everywhere

Swap the 7 bypasses (mind the sms/webhook null-contract nuance).
**Verify**: `grep -rn "process.env.NEXT_PUBLIC_APP_URL" app lib` → only
`lib/env/app-url.ts` + tests.

### c) `normalizePhoneKey(value: string): string`

Next to `formatPhoneNANP`; move the 11-digit comment INTO its docstring; swap
the 7 sites; one unit test (11-digit + formatted + short input) in
`lib/utils.test.ts` or a new file matching conventions.
**Verify**: `grep -rn "slice(-10)" app lib` → only the helper.

### d) ConfirmDialog + i18n for the 3 native confirms

Keys under the pages' existing namespaces, fr + en.
**Verify**: `grep -rn "window.confirm" app` → 0; parity test green.

### e) `shopLocale(defaultLanguage: string | null): 'fr' | 'en'`

One-liner helper; swap the 8 coercion sites.
**Verify**: `grep -rn "=== 'en' ? 'en' : 'fr'" app lib` → only the helper.

### f) Drop `notification_prefs`

Migration `20260610130000_drop_notification_prefs.sql`:
`drop table if exists public.notification_prefs;` with a header comment
naming the successor (`notification_automations`) and the zero-readers grep
as evidence. Remove its block from `supabase/seed.sql`.
**Verify**: `grep -rn "notification_prefs" app lib supabase/seed.sql` → 0.
(db/types.ts regen happens at next deploy — note it.)

### Final gates

**Verify**: `pnpm typecheck` && `pnpm test` && `pnpm lint` &&
`pnpm format:check` && `pnpm build` → all green.

## Test plan

The (c) unit test + i18n parity + the per-item greps. Everything else is
mechanical substitution covered by typecheck.

## Done criteria

- [ ] All six per-item greps pass (outputs in the report)
- [ ] typecheck/test/lint/format/build green
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Any call site's behavior depends on its variant's QUIRK (the sms/webhook
  null contract is the known one — handled above; if you find another, report).
- The seed.sql edit breaks `db reset` ordering (it shouldn't — verify the
  block is self-contained).

## Maintenance notes

- The deferred `withPublicTokenAction` wrapper (rate-limit + parse + verify
  preamble ×5) becomes trivial after this — it's the natural next sweep once
  plan 015's tests cover the public actions.
