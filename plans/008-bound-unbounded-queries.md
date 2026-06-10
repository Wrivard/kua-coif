# Plan 008: Bound the unbounded queries — crons, CSV export, winback, finances

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- app/api/cron/notifications/route.ts app/api/cron/birthday-greetings/route.ts "app/api/export/[entity]/route.ts" "app/[locale]/(app)/marketing/winback/page.tsx" "app/[locale]/(app)/finances/page.tsx" "app/[locale]/(app)/clients/page.tsx" supabase/migrations`
> On mismatch with the Current-state excerpts, STOP. (Plan 005 may legitimately
> have added `.eq('shop_id', …)` to the finances file — that is expected drift;
> anything else is not.)

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (touches a customer-facing cron and a money page; every change here is additive bounding + explicit truncation signals, no semantic rewrites)
- **Depends on**: plan 005 (same finances file — land 005 first)
- **Category**: bug / perf
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

PostgREST silently caps result sets (Supabase default `db-max-rows` = 1000).
Several queries assume "all rows" and have no `.limit()` — past the cap they
truncate **silently**: the reminder cron loads candidates across ALL shops
over a 72h horizon (reminders past row 1000 never send, no error), the
birthday cron fetches every DOB-bearing client per shop and filters month/day
in JS (clients past the cap never get a greeting; the code's own comment
claims the SQL index makes it cheap — false, no SQL predicate references the
indexed expressions), the clients CSV export ships at most 1000 rows of a
"full roster", the winback page aggregates a shop's entire appointment history
in JS (truncated history misclassifies ACTIVE clients as lapsed → they get
mass-emailed), and the finances range aggregates sum a possibly-truncated set
(wrong revenue/commissions on long ranges). None of these sites can currently
tell they were cut.

## Current state

(all verified at `ef34cee`)

- `app/api/cron/notifications/route.ts:102-113` — candidates query: `.gte` /
  `.lte` on `start_at` + `.in('status', …)`, **no `.order`, no `.limit`**.
  Route constraint: `maxDuration = 10` (line 48, Hobby cap) — full pagination
  is pointless here; the fix is an explicit ordered bound + loud capping.
- `app/api/cron/birthday-greetings/route.ts:101-116` — per-shop:
  `.select('id, shop_id, first_name, email, phone, date_of_birth')` filtered
  only by `shop_id` / `date_of_birth not null` / `anonymized_at is null` /
  `marketing_opted_out = false`, then **month/day matched in JS** (:110-116).
  The partial index `clients_birthday_md_idx` (migration
  `20260527050000_client_birthday_marketing_sends.sql`) is on
  `extract(month from date_of_birth), extract(day …)` — unusable by this query.
- `app/api/export/[entity]/route.ts:109-142` — `filterBuilder` =
  `.from(cfg.table).select(cfg.columns).eq('shop_id', activeShopId).order(…)`,
  **no `.limit`/`.range`**, result streamed to CSV.
- `app/[locale]/(app)/marketing/winback/page.tsx:41-66` — full client roster
  (no limit), then ALL their appointments (`select('client_id, start_at,
  status').eq('shop_id', shopId).in('client_id', clientIds)`, no limit), JS
  aggregation into `stats` (:70-74). The in-code comment defers to "10k
  appointments scale" — but the silent cap bites at 1000.
- `app/[locale]/(app)/finances/page.tsx:63-71` — range-filtered completed
  appointments + loyalty clients, summed in JS, no limit.
- `app/[locale]/(app)/clients/page.tsx` (barber branch, ~:52-67) — fetches
  every appointment `client_id` the barber ever had to derive their client
  set; unbounded.
- Established pattern for new SQL functions: lock EXECUTE — see
  `supabase/migrations/20260609170000_lock_security_definer_functions.sql`
  (`revoke execute … from public, anon, authenticated; grant … to service_role`).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass |
| Lint/format | `pnpm lint` && `pnpm format:check` | exit 0 |
| Build | `pnpm build` (placeholder env) | exit 0 |

## Scope

**In scope**:
- The 6 files above + ONE new migration
  `supabase/migrations/20260610110000_activity_and_birthday_fns.sql`
- `lib/observability.ts` import use only (captureException already exported)

**Out of scope**:
- Restructuring the finances commission math into SQL (follow-up after plan
  015's tests — record, don't do).
- The marketing send LOOPS' performance (sequential sends — separate concern).
- `app/[locale]/(app)/marketing/review-campaign/*` (same pattern, lower
  stakes — note it in your report if you confirm it, do not change it).
- Queue/fan-out architecture for the cron (deferred — see maintenance).

## Git workflow

- Conventional commit per step group, e.g.
  `fix(crons): explicit ordered bounds + loud capping on reminder/birthday loads`.
- Do NOT push unless instructed.

## Steps

### Step 1: Reminder cron — ordered bound + loud cap

In `app/api/cron/notifications/route.ts`, change the candidates query to add:
`.order('start_at', { ascending: true }).limit(1000)` (nearest-due first, so
a cap can only delay the FARTHEST reminders, never drop the imminent ones).
After the fetch, add:

```ts
if (allCandidates.length === 1000) {
  captureException(new Error('[cron/notifications] candidate load hit the 1000 cap'), {
    tags: { layer: 'cron', cron: 'notifications' },
    extra: { horizonMin: MAX_REMINDER_OFFSET_MIN + 15 },
  });
}
```

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Birthday cron — SQL-side month/day via a locked function

Migration part 1 — `birthday_clients`:

```sql
create or replace function public.birthday_clients(p_shop uuid, p_month int, p_day int)
returns setof public.clients
language sql stable as $$
  select * from public.clients
  where shop_id = p_shop
    and date_of_birth is not null
    and anonymized_at is null
    and marketing_opted_out = false
    and extract(month from date_of_birth) = p_month
    and extract(day from date_of_birth) = p_day
$$;
revoke execute on function public.birthday_clients(uuid, int, int) from public, anon, authenticated;
grant execute on function public.birthday_clients(uuid, int, int) to service_role;
```

(The `extract(...)` predicates match `clients_birthday_md_idx` — the index
finally serves the query.) In the route, replace the
fetch-all-then-JS-filter block (:101-116) with
`sb.rpc('birthday_clients', { p_shop: shop.id, p_month: todayMonth, p_day: todayDay })`
and keep the downstream `matches` shape (select the same columns off the
returned rows; adjust the local type, not the logic).

**Verify**: `pnpm typecheck` → exit 0; `grep -n "birthday_clients" app/api/cron/birthday-greetings/route.ts` → rpc call present; the JS month/day filter block is gone.

### Step 3: CSV export — paginate with `.range()`

In `app/api/export/[entity]/route.ts`, wrap the query in a page loop: page
size 1000, `.range(offset, offset + 999)`, accumulate until a page returns
< 1000 rows or a hard ceiling of 25 pages (25k rows) is hit; if the ceiling is
hit, append a final CSV comment row `# TRUNCATED at 25000 rows` AND
`captureException` with the entity + shop. Mind the existing
`statusFilter`/`filterBuilder` shape — the builder must be re-created per page
(PostgREST builders are single-use).

**Verify**: `pnpm typecheck` → exit 0.

### Step 4: Winback — SQL aggregate via a locked function

Migration part 2 — `client_activity`:

```sql
create or replace function public.client_activity(p_shop uuid)
returns table(client_id uuid, last_active_at timestamptz, has_completed boolean)
language sql stable as $$
  select a.client_id,
         max(a.start_at) filter (where a.status not in ('cancelled','no_show')) as last_active_at,
         bool_or(a.status = 'completed') as has_completed
  from public.appointments a
  where a.shop_id = p_shop and a.client_id is not null
  group by a.client_id
$$;
revoke execute on function public.client_activity(uuid) from public, anon, authenticated;
grant execute on function public.client_activity(uuid) to service_role;
```

In `winback/page.tsx`, replace the all-appointments fetch + JS `stats` loop
with one `admin.rpc('client_activity', { p_shop: shopId })` and build the same
`stats` Map from its rows (one row per client). KEEP the downstream
lapsed-classification logic untouched — read it first to confirm the Map shape
it expects (`latestActiveAt: string | null; hasCompleted: boolean`).

**Verify**: `pnpm typecheck` → exit 0; the `.in('client_id', clientIds)`
appointments query is gone from the file.

### Step 5: Finances — explicit bound + visible overflow

(After plan 005's shop filter.) Add `.limit(5000)` to the appointments range
query and `.limit(5000)` to the loyalty-clients query in
`finances/page.tsx`. If either returns exactly 5000 rows: `captureException`
(tags `layer:'finances'`) AND render the page's existing warning style with a
banner — add i18n keys `pages.finances.truncated` (fr: « Plage trop large —
résultats tronqués à 5000 rendez-vous ; réduisez la plage de dates. » / en:
"Range too large — results truncated at 5000 appointments; narrow the date
range.") in `messages/fr.json` + `messages/en.json` (the i18n-parity test will
fail if you miss one).

**Verify**: `pnpm vitest run tests/i18n-parity.test.ts` → pass; `pnpm typecheck` → exit 0.

### Step 6: Clients page barber branch — bound

In `clients/page.tsx` barber branch, add `.order('start_at', { ascending:
false }).limit(2000)` to the appointment-ids query (most recent first — a
barber's ACTIVE clients are in the recent window; with ~8 appts/day a 2000-row
window ≈ a year of work). Add a one-line comment stating the rationale.

**Verify**: `pnpm typecheck` → exit 0.

### Step 7: Full gates

**Verify**: `pnpm test` → all pass; `pnpm lint` && `pnpm format:check` → exit 0;
`pnpm build` → exit 0.

## Test plan

- The two SQL functions: if local Supabase (Docker) is available, smoke them
  in `supabase db reset` + a psql query; otherwise hand the migration to the
  operator with the step-5-style deployment note (same Management API flow as
  prior migrations, then `select count(*) from client_activity('<shop-id>')`).
- Route-level tests arrive with plan 015's harness; record these cases for it:
  cron cap → Sentry called; export 25-page ceiling → truncation marker present.

## Done criteria

- [ ] `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm format:check`, `pnpm build` all exit 0
- [ ] `grep -n "limit(1000)" app/api/cron/notifications/route.ts` → present with `.order`
- [ ] Migration file contains BOTH functions, each with the revoke/grant block
- [ ] No JS month/day birthday filter remains; no `.in('client_id', clientIds)` in winback/page.tsx
- [ ] Export route paginates (grep `.range(`)
- [ ] i18n parity test passes with the new finances keys
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The Supabase project's `db-max-rows` differs from 1000 in a way that changes
  the design (you cannot check it from the repo — if the operator supplies a
  different value, adjust constants, not structure).
- The winback downstream classification expects fields beyond
  `{latestActiveAt, hasCompleted}` (drift) — report before reshaping.
- `rpc()` calls fight the generated types (functions not yet in db/types.ts —
  they won't be until regen): use ONE localized `as any` cast at each rpc call
  with a `// types: regenerate db/types.ts post-deploy` comment; if you need
  more than that, STOP.

## Maintenance notes

- The reminder cron's 1000-bound + 10s maxDuration both cap throughput; the
  structural fix at fleet scale is a queue/fan-out (or Vercel Pro + bigger
  budget). The Sentry cap-alert is the tripwire that tells you when.
- After the operator deploys the migration, regenerate `db/types.ts`
  (`pnpm db:types:remote`) so the two rpc casts can be removed (plan 023
  sweeps casts anyway).
- review-campaign shares winback's shape — port `client_activity` usage there
  when it's next touched.
