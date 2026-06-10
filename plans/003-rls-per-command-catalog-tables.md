# Plan 003: Per-command RLS on catalog/config tables — manager-gate the writes at the data layer

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- supabase/migrations "app/[locale]/(app)/services/actions.ts" "app/[locale]/(app)/products/actions.ts" "app/[locale]/(app)/settings"`
> On mismatch with the Current-state excerpts, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (a wrong predicate can lock legitimate manager/owner writes out — staging test before prod; rollback = restore the old `_rw` policy)
- **Depends on**: none (deploy AFTER review; do not auto-deploy to prod)
- **Category**: security
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

The app's Server Actions gate catalog/pricing/marketing writes behind
`minRole: 'manager'` — but the RLS policies on those tables are still the flat
launch-era `FOR ALL USING (is_shop_member(shop_id))`. Any **barber** holding
their own session JWT can bypass the UI entirely and call PostgREST directly
(`/rest/v1/promo_codes`, `/rest/v1/services`, …) to insert a 100%-off promo
code, zero out service prices, delete products, or rewrite the loyalty/tips
config. This exact bypass was already identified and closed for the calendar
(`20260607130000_calendar_rls_per_command.sql`) and barbers
(`20260609180000_barbers_rls_and_audit.sql`) — the hardening was simply never
extended to the catalog tables. Within-tenant vertical escalation with direct
financial impact.

## Current state

- `supabase/migrations/20260523000002_rls.sql` — the flat policies to replace
  (verified at `ef34cee`; no later migration touches these tables):

```sql
create policy "services_rw" on public.services
  for all using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));          -- line 124
-- same shape: taxes :106 · service_categories :115 · products :164 ·
-- product_brands :152 · product_categories :158 · discounts :234 ·
-- promo_codes :240 · loyalty_program :246 · tips_config :267 ·
-- waiting_list_config :286
-- subquery variants (via the parent row's shop):
--   service_taxes :131 · product_taxes :170
-- special case:
create policy "commission_tiers_rw" on public.commission_tiers
  for all using (public.has_role_in_shop(shop_id, 'manager'))    -- line 252
  with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "commission_tiers_select_self" ...                  -- line 256 (keep)
```

- `saveCommissions` is `minRole: 'owner'`
  (`app/[locale]/(app)/settings/commissions/actions.ts:14`) — so today a
  *manager* can write their own commission tiers via PostgREST despite the
  owner-only action. This plan aligns the policy to **owner** for writes.
- The **exemplar to mirror**: read
  `supabase/migrations/20260609180000_barbers_rls_and_audit.sql` before
  writing anything — copy its structure exactly (drop-if-exists + 4
  per-command policies + idempotency style + comments).
- The helper functions exist since launch: `is_shop_member(uuid)`,
  `has_role_in_shop(uuid, text)` (rank-based: owner ≥ manager ≥ barber).
- **Public booking is unaffected**: the public flow uses the service-role
  client (`app/[locale]/book/[shopSlug]/actions.ts:184` —
  `createSupabaseServiceRoleClient()`), which bypasses RLS. Same for crons and
  the widget.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (no TS in this plan, regression only) | `pnpm typecheck` | exit 0 |
| Local DB test (ONLY if Docker available) | `pnpm db:reset` then `pnpm db:test` | migrations apply; tests pass |

## Scope

**In scope**:
- ONE new file: `supabase/migrations/20260610100000_catalog_rls_per_command.sql`
- `supabase/tests/rls_cross_shop.sql` (append role-deny assertions — optional
  step 4, only if the file's existing structure supports it cleanly)

**Out of scope**:
- `clients` / `appointments` / `blocked_time` / `barbers` / `barber_settings`
  policies — already per-command or deliberately flat (barbers legitimately
  create clients).
- `shops`, `shop_members`, `payment_profiles`, `audit_log` — separately
  modeled; do not touch.
- Any TypeScript file. Any change to the Server Actions' `minRole`.
- Deploying to production — the operator deploys (see step 5).

## Git workflow

- Conventional commit: `fix(security): per-command RLS on catalog/config tables`.
- Do NOT push unless instructed.

## Steps

### Step 1: Verify every writer is manager+ in app code (read-only recon)

For each table below, confirm the writing Server Action declares
`minRole: 'manager'` (or `'owner'`), so the new policies can't break the app:

```
grep -n "minRole" "app/[locale]/(app)/services/actions.ts" "app/[locale]/(app)/products/actions.ts" "app/[locale]/(app)/settings/taxes/actions.ts" "app/[locale]/(app)/settings/discounts/actions.ts" "app/[locale]/(app)/settings/promo-codes/actions.ts" "app/[locale]/(app)/settings/loyalty/actions.ts" "app/[locale]/(app)/settings/waiting-list/actions.ts" "app/[locale]/(app)/settings/commissions/actions.ts" "app/[locale]/(app)/settings/shop/actions.ts"
```

Expected: every mutation in those files is `manager` or `owner`. The
tips_config writer lives in the shop-details or commissions settings action —
locate it with `grep -rn "tips_config" "app/[locale]"` and confirm its gate.
If ANY writer of these tables runs with `minRole: 'barber'` → STOP (the policy
would break it; report the action).

**Verify**: paste the grep output in your report; all `minRole` ≥ manager.

### Step 2: Write the migration

Create `supabase/migrations/20260610100000_catalog_rls_per_command.sql`,
mirroring the structure of `20260609180000_barbers_rls_and_audit.sql`. For
each simple table in
[services, service_categories, products, product_brands, product_categories,
taxes, discounts, promo_codes, loyalty_program, tips_config,
waiting_list_config]:

```sql
drop policy if exists "<table>_rw" on public.<table>;
drop policy if exists "<table>_select" on public.<table>;
drop policy if exists "<table>_insert" on public.<table>;
drop policy if exists "<table>_update" on public.<table>;
drop policy if exists "<table>_delete" on public.<table>;
create policy "<table>_select" on public.<table>
  for select using (public.is_shop_member(shop_id));
create policy "<table>_insert" on public.<table>
  for insert with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "<table>_update" on public.<table>
  for update using (public.has_role_in_shop(shop_id, 'manager'))
  with check (public.has_role_in_shop(shop_id, 'manager'));
create policy "<table>_delete" on public.<table>
  for delete using (public.has_role_in_shop(shop_id, 'manager'));
```

For the two M:N tables (`service_taxes`, `product_taxes`): same 4 commands,
but every predicate is the existing exists-subquery against the parent
(`services s where s.id = service_taxes.service_id`), with
`has_role_in_shop(s.shop_id, 'manager')` for the writes and `is_shop_member`
for select (copy the subquery shape from `20260523000002_rls.sql:131-145`).

For `commission_tiers`: drop `commission_tiers_rw`; create select =
`has_role_in_shop(shop_id, 'manager')` (managers see the page), writes =
`has_role_in_shop(shop_id, 'owner')` (matches `saveCommissions`'s
`minRole: 'owner'`). KEEP `commission_tiers_select_self` untouched (barbers
read their own tiers).

Header comment must state the threat model (barber JWT → PostgREST direct
write) and reference this plan.

**Verify**: `grep -c "create policy" supabase/migrations/20260610100000_catalog_rls_per_command.sql` → 56 (13 simple tables × 4 + 2 subquery tables × 4 + commission_tiers select+insert+update+delete... count YOUR actual statements and assert that exact number; state it in the report). File ends with no `BEGIN/COMMIT` (match the exemplar's style).

### Step 3: Static sanity review

Re-read the migration against the exemplar checklist: every `for update` has
BOTH `using` and `with check`; no table lost its `force row level security`
(this migration doesn't touch it — it was set in 20260523000002); subquery
predicates reference the right parent column.

**Verify**: `pnpm typecheck` → exit 0 (unchanged — regression guard only).

### Step 4 (optional, only if Docker/supabase-local available): extend the RLS test

Append to `supabase/tests/rls_cross_shop.sql` (matching its existing
transaction-rollback style) a case that: creates a barber-role member, sets
the JWT claims, attempts `insert into promo_codes` and `update services set
price = 0` → both must be DENIED; then as a manager member both succeed.
If the file's harness doesn't support role switching cleanly, skip and note it.

**Verify**: `pnpm db:test` → passes (or step skipped with reason).

### Step 5: Hand off for deployment (do NOT deploy yourself)

In your report, include the operator deployment block: apply the migration to
STAGING/prod via the established Management API flow, then smoke-test as a
real **barber** account: (a) services/products/settings pages still render
(SELECT intact); (b) a direct PostgREST `POST /rest/v1/promo_codes` with the
barber JWT returns 403/42501; (c) a manager can still save services, taxes,
discounts, promo codes, loyalty, waiting list, shop tips; (d) an owner can
still save commissions — and a manager now CANNOT (expected new behavior —
flag this to the operator as the one visible change).

## Test plan

Step 4's pgTAP-style assertions are the durable regression. Until the CI db
job exists (plan 016), the staging smoke checklist in step 5 is the gate.

## Done criteria

- [ ] Migration file exists, named `20260610100000_catalog_rls_per_command.sql`
- [ ] It contains per-command policies for ALL 14 tables listed (13 simple + commission_tiers) + the 2 subquery tables
- [ ] `grep -n "for all" supabase/migrations/20260610100000_catalog_rls_per_command.sql` → no matches
- [ ] `pnpm typecheck` exits 0; `pnpm test` exits 0 (unchanged)
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated; report includes the step-5 operator block

## STOP conditions

- Step 1 finds ANY barber-role writer of these tables in app code.
- You find a LATER migration (after `20260523000002`) that already redefines
  one of these tables' policies — reconcile, don't blind-drop (adjust the
  drop-if-exists names to what actually exists).
- The exemplar migration's structure differs materially from what this plan
  assumes (e.g. it wraps in DO blocks) — follow the exemplar, and note the delta.
- Anything tempts you to also change `clients` policies — out of scope.

## Maintenance notes

- The one behavior change: **managers can no longer write commission tiers via
  ANY path** (previously possible via PostgREST). If the product later wants
  manager-editable commissions, lower BOTH the action's `minRole` and the
  policy together.
- Every future shop-scoped table must ship per-command policies from day one —
  the flat `_rw` pattern is now considered a defect.
- After this lands, revisit the deferred DEBT-09 (moving
  settings/notifications + payments actions from service-role to the RLS
  client) — the policies will then enforce what those actions hand-check.
