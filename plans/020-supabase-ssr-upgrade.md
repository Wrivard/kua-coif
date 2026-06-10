# Plan 020: Upgrade @supabase/ssr 0.5.2 → 0.12.x — modern cookie API, kill the double-assert

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- lib/supabase package.json`
> On mismatch with the Current-state excerpts, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED-HIGH surface (the session/auth core — every request flows
  through these factories) but a SMALL, well-understood diff; mandatory
  behavior pass on login/refresh
- **Depends on**: plan 016 (auth e2e as safety net — recommended)
- **Category**: migration
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

`@supabase/ssr@0.5.2` is 7 minor lines behind and declares a stale
`SupabaseClient` generic, worked around in `lib/supabase/server.ts` with a
documented `as unknown as SupabaseClient<Database>` double-assert — the
workaround restores type safety for callers, but every new reader of that
file inherits the confusion, and the legacy `get/set/remove` cookie API the
file uses is REMOVED in newer ssr lines (the longer this waits, the bigger
the jump). 0.12.x peers on supabase-js `^2.108` (installed: 2.106 via
`^2.46` — one minor bump) and is built against the modern 4-generic client,
so the assert can be deleted and the cookie code modernized in one small PR.

## Current state

(verified at `ef34cee`)

- `lib/supabase/server.ts` — read in full; the whole file is the legacy
  pattern: `cookies: { get(name), set(name, value, options) { try { … } catch
  {} }, remove(name, options) { … } }` + the double-assert at :45 with its
  6-line explanatory comment (:6-11, :40-44).
- `lib/supabase/middleware.ts` — ALREADY uses the modern `getAll/setAll`
  cookie API (:36-47 per the audit; read to confirm) → it is the in-repo
  template for rewriting server.ts.
- `lib/supabase/client.ts` (browser) + `lib/supabase/service-role.ts`
  (supabase-js `createClient<Database>` directly — NOT ssr; untouched).
- `package.json`: `"@supabase/ssr": "^0.5.2"`, `"@supabase/supabase-js":
  "^2.46.1"` (resolves 2.106.2).
- Server Components can't mutate cookies — the current try/catch swallow
  (:24-29) preserves that; the getAll/setAll form needs the same swallow
  (middleware.ts shows where).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Upgrade | `pnpm add @supabase/ssr@^0.12 @supabase/supabase-js@^2.108` | lockfile updated |
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass |
| Build | `pnpm build` | exit 0 |
| E2E | `pnpm test:e2e` (auth spec) if available | green |

## Scope

**In scope**:
- `package.json` + lockfile (the two packages)
- `lib/supabase/server.ts` (getAll/setAll rewrite + delete the double-assert
  + delete the two workaround comments)
- `lib/supabase/middleware.ts` + `lib/supabase/client.ts` ONLY if the 0.12
  changelog requires it (middleware likely already conformant)

**Out of scope**:
- `lib/supabase/service-role.ts` (plain supabase-js — only the supabase-js
  minor bump touches it, no code change).
- The 126 downstream `as any` casts (plan 023 — do NOT start de-casting here;
  but this plan UNBLOCKS it).
- Auth flows/logic, cookie names, session semantics.

## Git workflow

- Conventional commit: `chore(deps): @supabase/ssr 0.12 — modern cookie API, drop the generic workaround`.
- Do NOT push unless instructed.

## Steps

### Step 1: Read the ssr changelog 0.5 → 0.12

From the installed package / repo releases. List breaking changes; the known
one is cookies `get/set/remove` → `getAll/setAll` (REQUIRED). Note anything
about cookie options encoding (chunked cookies) — the middleware file shows
the working local convention.

### Step 2: Upgrade + rewrite server.ts

`pnpm add @supabase/ssr@^0.12 @supabase/supabase-js@^2.108`. Rewrite
`createSupabaseServerClient` on the getAll/setAll shape, preserving the
Server-Component swallow:

```ts
cookies: {
  getAll() { return cookieStore.getAll(); },
  setAll(cookiesToSet) {
    try {
      for (const { name, value, options } of cookiesToSet)
        cookieStore.set(name, value, options);
    } catch {
      // Server Component — mutation not allowed; middleware refresh handles it.
    }
  },
},
```

Delete the `as unknown as SupabaseClient<Database>` and its comments; the
return type annotation `: SupabaseClient<Database>` can stay if it now
type-checks naturally (it should — that's the point; if it does NOT, STOP).

**Verify**: `pnpm typecheck` → exit 0 with the assert REMOVED (this is the
proof the upgrade fixed the generic). `pnpm test` → all pass. `pnpm build` → exit 0.

### Step 3: Behavior pass (mandatory)

With a dev server + real env (or the 016 e2e job): login → session persists
across reload; an authenticated Server Action mutation works; session refresh
near expiry works (middleware leg); logout clears. Record each result. If no
live env is available locally, state it and gate the merge on the operator
running the checklist.

## Test plan

- `tests/e2e/auth.spec.ts` covers login if runnable.
- No new unit tests — the factories are I/O shells; the typecheck-without-
  assert IS the regression proof for the type half.

## Done criteria

- [ ] ssr resolves ≥ 0.12, supabase-js ≥ 2.108 (`pnpm why` output in report)
- [ ] `grep -n "as unknown as SupabaseClient" lib/supabase/server.ts` → no matches
- [ ] `grep -n "getAll\|setAll" lib/supabase/server.ts` → modern API in place
- [ ] typecheck/test/build green; behavior checklist recorded
- [ ] Diff limited to the in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

- Typecheck still infers `never[]` on writes after the upgrade (the premise —
  0.12 generics fixed it — would be wrong): restore the assert, report.
- The middleware client (`lib/supabase/middleware.ts`) breaks under 0.12
  (cookie chunking change) — report before adapting auth-refresh logic.
- supabase-js 2.106→2.108 surfaces ANY behavior diff in tests — report
  (expected: none).

## Maintenance notes

- This plan is the gate for plan 023 (de-cast): with the factory generics
  honest, the 126 downstream `as any` lose their last excuse.
- Keep ssr and supabase-js bumped TOGETHER from now on (the 0.5.2 incident
  was a peer drift).
