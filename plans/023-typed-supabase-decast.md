# Plan 023: De-cast the typed Supabase client (~126 vestigial `as any`) + collapse db/rows.ts to generated aliases

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- lib/supabase db/rows.ts db/types.ts`
> Plan 020 must be DONE (check its status row) — it removes the last
> structural excuse for the casts. If db/types.ts changed since `ef34cee`
> (migrations from plans 003/008/013 regenerating it), that is EXPECTED and
> GOOD — regenerate again if pending migrations deployed (step 0).

## Status

- **Priority**: P3
- **Effort**: L (mechanical but wide — ~88 files; wave it)
- **Risk**: LOW-MED (type-only; the real risk is DISCOVERING genuine shape
  mismatches the casts were hiding — each one found is a latent bug surfaced,
  handle per the STOP rules)
- **Depends on**: plan 020
- **Category**: tech-debt
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

Both client factories return `SupabaseClient<Database>` — yet ~126 call sites
across ~88 files immediately cast it away (`createSupabaseServiceRoleClient()
as any` / `createSupabaseServerClient() as any`), so virtually all DB I/O
compiles with zero schema checking. The knock-on cost is bigger than the
casts: ~hundreds of hand-written inline `as Array<{...}>` result shapes exist
ONLY because the client is untyped, and several have already drifted from the
generated truth. A migration can rename a column and nothing fails until
runtime. Separately, `db/rows.ts` is a parallel hand-maintained type system
whose own header declares its sunset condition ("once codegen ships…
collapse to aliases") — codegen shipped; 39 files still import the manual
types.

## Current state

- Cast inventory (verified by grep at `ef34cee`): 128 textual occurrences /
  88 files (2 are docs). Densest: `lib/google/sync.ts` (7),
  `app/[locale]/(app)/settings/notifications/actions.ts` (7),
  `app/api/webhooks/stripe/route.ts` (6),
  `app/[locale]/(app)/settings/payments/actions.ts` (6),
  `app/[locale]/book/[shopSlug]/actions.ts` (4+).
  Regenerate the list yourself:
  `grep -rln "createSupabaseServiceRoleClient() as any\|createSupabaseServerClient() as any" app lib`
- Known DELIBERATE exceptions (keep, with a comment, or replace with ONE
  named helper):
  - `app/api/export/[entity]/route.ts:111-129` — dynamic table name from a
    whitelist; generated types can't express it. Wrap as
    `function dynamicTable(sb: SupabaseClient<Database>, table: Entity)` with
    a single documented cast inside.
  - `lib/audit-log.ts` — structural stub casts (post-plan-007 docstring);
    convert to typed inserts (audit_log IS in db/types.ts).
  - Hand-written structural stubs: `app/[locale]/(app)/services/actions.ts:26-55`,
    `app/[locale]/(app)/products/actions.ts:23` — their comments say "until
    codegen ships" — codegen shipped; delete the stubs.
- `db/rows.ts` — manual row types, header states the collapse plan; imported
  by ~39 files; `bookable` was manually added (`:68-70`). `db/types.ts` is
  generated and current (verify freshness in step 0).
- The de-cast pattern is PROVEN in this repo: clients/actions.ts and the
  calendar actions were de-casted in prior commits (`75ecca5`, `a9853dd`) —
  open one of them (`git show 75ecca5 --stat`) to see the mechanical shape.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Types regen (if migrations pending) | `pnpm db:types:remote` (operator-gated: needs link/PAT) or `pnpm db:types:local` (Docker) | db/types.ts current |
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass |
| Cast census | `grep -rn "() as any" app lib | measure` | shrinking per wave |

## Scope

**In scope**:
- The ~88 files with factory casts (waves below)
- `db/rows.ts` (alias collapse) — NOT its 39 importers beyond what aliasing
  forces (aliases are drop-in)
- `lib/audit-log.ts` typed inserts

**Out of scope**:
- Behavior. Query shapes. New abstractions beyond `dynamicTable`.
- The inline `as Array<{...}>` RESULT casts that still typecheck — delete
  them ONLY where the typed client now infers the shape (most will); where a
  result cast still narrows something real (joins/embedded selects), keep it
  and move on. No heroics on embedded-select typing.

## Git workflow

- One commit per wave: `refactor(types): de-cast <area> (wave N)`. Do NOT
  push unless instructed.

## Steps

### Step 0: Freshness gate

If plans 003/008/013's migrations are deployed but db/types.ts predates them,
regenerate (operator may need to run the remote variant). The whole plan
assumes current types. Record the db/types.ts mtime/commit in the report.

### Step 1: Collapse db/rows.ts

Per its own header: each manual type becomes
`export type ServiceRow = Database['public']['Tables']['services']['Row'];`
(use `Pick<>` where the manual type was intentionally narrower — compare
field-by-field; any manual field NOT in the generated type is drift: report
it, don't invent). Importers keep compiling unchanged.

**Verify**: `pnpm typecheck` → exit 0; `pnpm test` → pass.

### Step 2: Waves of de-cast (lib/ → api/ → actions/ → pages)

Per wave: delete the `as any` on the factory call, run `pnpm typecheck`, fix
fallout in THAT wave's files only — fallout is usually (a) deletable result
casts, (b) `.rpc()` names not in types (regen or one localized cast +
comment), (c) GENUINE mismatches (see STOP). Wave order:
1. `lib/` (google/sync, email, sms, business orchestrators, data loaders,
   stripe, quickbooks)
2. `app/api/` (webhooks, crons, export via `dynamicTable`, oauth callbacks)
3. `app/**/actions.ts` (settings/*, marketing, book, me/reschedule/review/unsubscribe, super-admin)
4. `app/**/page.tsx` + remaining

**Verify after each wave**: typecheck + `pnpm test` green; census count down;
commit.

### Step 3: Census zero (minus documented exceptions)

**Verify**: `grep -rn "createSupabaseServiceRoleClient() as any\|createSupabaseServerClient() as any" app lib`
→ ONLY the documented exceptions (target: 0–2 sites, each with a
`// typed-exception:` comment). `pnpm build` → exit 0.

## Test plan

No new tests — the compiler IS the test (every surfaced error is the plan
working). Full suite green per wave is the regression gate.

## Done criteria

- [ ] Census ≤ 2 with documented exceptions; db/rows.ts is aliases only
- [ ] typecheck/test/build green at every wave commit
- [ ] Genuine-mismatch list (step 2c findings) in the report — each either
      fixed-as-obvious or escalated, none silently re-cast
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- A surfaced type error reveals a REAL shape divergence on a money path
  (webhook, booking, refunds) — do not "fix" the type to silence it; report
  the file:line and both shapes (it may be a latent production bug).
- More than ~5 `.rpc()` names missing from types — the regen didn't happen;
  back to step 0.
- A wave's fallout exceeds ~2× its cast count — the wave hides a structural
  issue; stop and report before bulk-editing.

## Maintenance notes

- Reviewer rule going forward: a NEW `as any` on a Supabase client is an
  automatic reject; `// typed-exception:` requires a reason.
- Consider (follow-up, not here) an ESLint `no-restricted-syntax` rule
  matching the cast pattern.
- Plan 016's types-drift CI gate keeps db/types.ts honest from now on — the
  combination is what makes this de-cast PERMANENT instead of a cleanup that
  rots back.
