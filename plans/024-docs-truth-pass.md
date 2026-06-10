# Plan 024: Docs truth pass — rewrite CLAUDE.md, regenerate .env.example, fix DEPLOY.md secrets, archive the stale snapshots

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- CLAUDE.md README.md DEPLOY.md ARCHITECTURE.md .env.example`
> On unexplained mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (docs + an example file; ONE trap: CLAUDE.md is auto-loaded
  into every AI session on this repo — a wrong rewrite misleads every future
  agent, so the new content is specified below, not improvised)
- **Depends on**: none
- **Category**: docs / dx
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

This repo is largely agent-operated — and the file injected as INSTRUCTIONS
into every agent session (CLAUDE.md) is the original build SPEC, now actively
wrong: it mandates `@tanstack/react-query`/`react-table` (REMOVED from the
repo), declares the theme "dark only V1" (light is the default now), pins a
finished phase plan, and prescribes `npm run build` in a pnpm-only repo whose
CI comments record the exact damage npm/pnpm drift already caused. The
onboarding chain is equally broken: `.env.example` documents ~12 of the ~29
env vars the code reads — omitting the one that bricks everything if lost
(`NOTIFICATION_ENCRYPTION_KEY` encrypts SMTP/Google/QB/Twilio credentials AND
signs every customer link) — while DEPLOY.md's disaster-recovery list names
TWO secrets that don't exist (`SIGNING_SECRET`, `GOOGLE_CALENDAR_*`) and
omits that real one. Ten frozen AUDIT*.md snapshots at the root contradict
the current state for anyone (human or agent) who greps.

## Current state

(verified at `ef34cee`)

- `CLAUDE.md` — the full original spec (~700 lines incl. the seed annexe).
  The annexe (Partie 2 — SEED exact) is STILL REFERENCED by
  `supabase/seed.sql` content — it must remain reachable, just not as live
  instructions.
- `.env.example` — read in full: Supabase (4 vars) + Sentry (6) + Stripe (4)
  ONLY. Missing-but-read (grep `process.env.` across app/ lib/ to build the
  authoritative list; known set): `NEXT_PUBLIC_APP_URL` (lib/env/app-url.ts:26
  — every signed customer URL), `NOTIFICATION_ENCRYPTION_KEY`
  (lib/crypto/aes.ts, lib/security/signed-tokens.ts:52), `CRON_SECRET`
  (lib/security/cron-auth.ts), `UPSTASH_REDIS_REST_URL/TOKEN`
  (lib/auth/rate-limit.ts), `RESEND_API_KEY/FROM/REPLY_TO` (lib/email/client.ts),
  `TURNSTILE_SECRET_KEY` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
  (lib/security/turnstile.ts), `GOOGLE_OAUTH_CLIENT_ID/SECRET`
  (lib/google/server.ts), `QUICKBOOKS_CLIENT_ID/SECRET/ENVIRONMENT`
  (lib/quickbooks/server.ts), `NEXT_PUBLIC_SITE_URL` (app/robots.ts, auth),
  `KUA_GITHUB_TOKEN` (super-admin page), `STRIPE_APP_FEE_BPS` (present),
  `PLAYWRIGHT_USER_EMAIL/PASSWORD` (e2e).
- `DEPLOY.md:320-334` — the DR secrets list with the two phantom names and
  the `NOTIFICATION_ENCRYPTION_KEY` omission (excerpt verified). Earlier
  sections still describe "the 3 migrations" era (56+ exist) and an
  impossible signup walkthrough (signup removed — `middleware.ts:16-19`
  documents the whitelist model).
- Root clutter: `AUDIT.md` + 9 `AUDIT_PHASE*.md` (frozen 2026-05-23→26),
  `FRONTEND_REVAMP_PLAN.md` (executed), `vercel_DESIGN.md` (input to a done
  pivot). STILL-LIVE root docs to NOT move: `FEATURE_CLIENTS.md`,
  `DECISIONS.md`, `WIDGET-SPEC.md`, `README.md`, `ARCHITECTURE.md` (stale but
  handled below).
- README/ARCHITECTURE staleness (claims react-query/providers dir/4-or-5
  migrations/56 tests; ARCHITECTURE simultaneously claims "spec fermée 100%"
  and "0/26 tables créées") — fix the load-bearing claims, don't rewrite
  wholesale.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Env inventory | `grep -rn "process.env." app lib middleware.ts i18n.ts --include="*.ts" --include="*.tsx" -o | sort -u` (adapt) | the authoritative var list |
| Tests | `pnpm test` | unaffected, green |

## Scope

**In scope**:
- `CLAUDE.md` (rewrite), `.env.example` (regenerate), `DEPLOY.md` (surgical
  fixes), `README.md` (surgical fixes), `ARCHITECTURE.md` (header banner)
- NEW `docs/archive/` (moves + index)

**Out of scope**:
- `DECISIONS.md`, `FEATURE_CLIENTS.md`, `WIDGET-SPEC.md`, the in-app help
  center, `docs/payments-flow.md`/`docs/tenancy.md` (valuable but separate —
  record as follow-up).
- Deleting anything (archive ≠ delete).

## Git workflow

- Conventional commits per file group: `docs(claude): rewrite as current-state instructions`, etc. Do NOT push unless instructed.

## Steps

### Step 1: Archive sweep

`git mv` AUDIT.md AUDIT_PHASE*.md FRONTEND_REVAMP_PLAN.md vercel_DESIGN.md →
`docs/archive/`. Add `docs/archive/README.md`: "Historical snapshots, frozen
at their dates — do NOT treat as current state; the live operational docs are
CLAUDE.md / README.md / DEPLOY.md / DECISIONS.md." Prepend each moved file
with one banner line (`> ARCHIVED <date> — superseded; see docs/archive/README.md`).
Fix any README links pointing at the moved files
(`grep -n "AUDIT" README.md`).

**Verify**: `Get-ChildItem *.md` at root no longer lists them; README has no
dead links to them.

### Step 2: Rewrite CLAUDE.md (the high-stakes one)

Replace the spec with a ~120-line CURRENT-STATE agent brief containing
exactly these sections (draft from the repo, not from memory):
1. What this is (multi-tenant salon SaaS, Küa, Quebec, fr/en).
2. Stack facts (Next 14 App Router [or current], TS strict, Supabase RLS
   multi-tenant by shop_id, Stripe Connect, next-intl, Tailwind tokens,
   light+dark themes — light default).
3. NON-NEGOTIABLES for agents: **pnpm ONLY** (cite the ci.yml Loop-41
   history); verification commands (`pnpm typecheck/test/lint/format:check/build`
   + placeholder env); conventional commits with scope; every UI string via
   next-intl fr+en (parity test enforces); every shop-scoped page query
   carries `.eq('shop_id', activeShopId)`; service-role client = RLS bypass,
   scope explicitly; money/consent audit via `logDurableAudit`; new tables
   ship per-command RLS; no secrets in logs/docs.
4. Map: key directories + the pattern exemplars (withAction, calendar-config
   cache, signed-tokens, plans/README.md for in-flight work).
5. Pointer: "Original build spec + exact seed data: docs/archive/SPec — the
   seed annexe remains authoritative for seed VALUES."
Move the original spec to `docs/archive/SPEC-original.md` (git mv, banner
line on top).

**Verify**: `grep -n "tanstack\|dark only\|npm run" CLAUDE.md` → no matches;
file < 200 lines; the archived spec exists.

### Step 3: Regenerate .env.example

From the step-0 inventory: every var, grouped `# REQUIRED (app boots/links
break without it)` / `# Feature-gated (feature silently off without it)` /
`# Dev/test only`, one comment line each stating what turns on and where
it's read (file path). Include the three-URL story explicitly
(`NEXT_PUBLIC_SITE_URL` vs `NEXT_PUBLIC_APP_URL` + the GH-Actions `APP_URL`
secret) with one line on which to set where. NEVER include real values.

**Verify**: for each var name in the code inventory, `grep -c "<name>" .env.example` ≥ 1 (script it; paste the count table).

### Step 4: DEPLOY.md surgical fixes

(a) DR secrets list (:328-334): remove `SIGNING_SECRET` and
`GOOGLE_CALENDAR_*`; add `NOTIFICATION_ENCRYPTION_KEY` with a red-flag note
("losing it bricks every shop's SMTP/Google/QB/Twilio credentials and
invalidates all customer links — unrecoverable"), add `CRON_SECRET`,
`UPSTASH_*`, `QUICKBOOKS_CLIENT_SECRET`, `CLAUDE_CODE_OAUTH_TOKEN` (GH
secret). (b) Replace the "3 migrations" instructions with `supabase db push`
semantics + the Management-API note. (c) Replace the dead signup walkthrough
with the whitelist reality (point at the `shop_members` SQL + super-admin
shops/new). (d) Refresh the env table from step 3's file.

**Verify**: `grep -n "SIGNING_SECRET\|GOOGLE_CALENDAR_" DEPLOY.md` → no
matches; `grep -n "NOTIFICATION_ENCRYPTION_KEY" DEPLOY.md` → in the DR list.

### Step 5: README + ARCHITECTURE minimal honesty

README: fix the stack list (drop react-query/providers), the migrations
count claim ("see supabase/migrations" instead of a number), the test-counts
line (point at CI), the cron story (GH Actions + vercel.json split), add the
"first local login" recipe (whitelist model — auth user + shop_members
one-liner). Move the phase-ledger lines (≈293-359) to
`docs/archive/PHASES.md`. ARCHITECTURE.md: prepend a banner ("⚠️ Snapshot of
the original plan — superseded in places; for current conventions see
CLAUDE.md") — full rewrite is the recorded follow-up, not this plan.

**Verify**: `grep -n "react-query\|QueryProvider" README.md` → no matches;
`pnpm test` still green (nothing code-touching).

## Test plan

Not code. The verification greps above are the machine gates; a human skim of
CLAUDE.md by the operator is the acceptance step (call it out in the report).

## Done criteria

- [ ] All step verifies pass (greps + counts in the report)
- [ ] Root *.md = only living docs; archive indexed + bannered
- [ ] CLAUDE.md < 200 lines, zero stale mandates, archived spec linked
- [ ] .env.example covers the full inventory
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- You find a CLAUDE.md mandate that is stale but whose CURRENT truth you
  cannot determine from the repo (e.g. a deploy fact) — put a `TODO(operator)`
  line rather than guessing.
- `git mv` of a file that something imports (none should — these are docs;
  verify with a grep per file before moving).

## Maintenance notes

- The follow-up docs worth writing next (recorded, not in scope):
  `docs/payments-flow.md` (booking→PI→webhook→reconcile→finances + failure
  modes) and `docs/tenancy.md` (RLS model + service-role rules) — both
  flagged by the audit as incident-time gaps.
- CLAUDE.md is now an OPERATIONAL contract — changing conventions (e.g.
  plan 003's "per-command RLS required") must update it in the same PR.
