# Plan 006: Manager gate on the QuickBooks OAuth start route

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- app/api/quickbooks/oauth/start/route.ts app/api/google/oauth/start/route.ts`
> On mismatch with the Current-state excerpts, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (additive role check on one route; owners/managers unaffected)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

Connecting QuickBooks binds the shop's books to an Intuit company: every
completed appointment then syncs a SalesReceipt — customer names + amounts —
into that company. The start route currently requires only "authenticated +
has an active shop": **any member, including a barber, can run the OAuth flow
against their own Intuit account** and silently route the shop's financial
data to themselves. The Google Calendar start route had this same hole and was
fixed (Barbers audit B3) with an explicit manager-rank check; the QuickBooks
route was never given the same gate — note the asymmetry: connect is
any-member while `disconnectQuickbooks` is `minRole: 'owner'`.

## Current state

- `app/api/quickbooks/oauth/start/route.ts:28-46` (at `ef34cee`) — the gate
  today is only:

```ts
const user = await getCurrentUser();
if (!user) {
  return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
}
const shopId = await getCurrentShopId();
if (!shopId) {
  return NextResponse.json({ error: 'no_shop' }, { status: 403 });
}
// → builds signed state {shopId, nonce, exp} and redirects to Intuit
```

- The pattern to copy — `app/api/google/oauth/start/route.ts:48-84`: it pulls
  `getShopMemberships()`, resolves the target shop, then:

```ts
const membership = memberships.find((m) => m.shop_id === barber.shop_id);
if (!membership || (ROLE_RANK[membership.role] ?? 0) < ROLE_RANK.manager) {
  return NextResponse.json({ error: 'forbidden' }, { status: 403 });
}
```

  with a local `ROLE_RANK = { owner: 3, manager: 2, barber: 1 } as const`
  (declared near the top of the google route — read it and copy the exact
  declaration).
- The QB flow is shop-scoped (no barber_id param), so the check is simpler
  than Google's: membership for `shopId` must exist with rank ≥ manager.
- `getShopMemberships` is exported from `@/lib/auth/server` (the google route
  imports it — copy the import).
- The callback route (`app/api/quickbooks/oauth/callback/route.ts`) does NOT
  need a change: it only honors a state signed by THIS start route within a
  10-minute TTL, so gating the mint gates the flow. State that in the commit
  message body.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass |
| Lint/format | `pnpm lint` && `pnpm format:check` | exit 0 |

## Scope

**In scope**:
- `app/api/quickbooks/oauth/start/route.ts` only.

**Out of scope**:
- The callback route (reason above). The Google routes. `disconnectQuickbooks`
  (already owner-gated). Any UI change (the settings page already only shows
  the connect button to managers+ — server enforcement is what's missing).

## Git workflow

- Conventional commit: `fix(security): manager gate on QuickBooks OAuth start (mirrors Google B3)`.
- Do NOT push unless instructed.

## Steps

### Step 1: Add the gate

In `app/api/quickbooks/oauth/start/route.ts`:

1. Import `getShopMemberships` alongside the existing
   `@/lib/auth/server` imports.
2. Add the `ROLE_RANK` const (copy the exact `as const` declaration from the
   google start route).
3. After the `if (!shopId)` guard, insert:

```ts
// SECURITY — connecting the shop's books is a manager action (mirrors the
// Google OAuth start gate, Barbers audit B3). Without this, any member —
// including a barber — could bind the shop to their own Intuit company and
// exfiltrate customer names + amounts via the SalesReceipt sync.
const memberships = await getShopMemberships();
const membership = memberships.find((m) => m.shop_id === shopId);
if (!membership || (ROLE_RANK[membership.role] ?? 0) < ROLE_RANK.manager) {
  return NextResponse.json({ error: 'forbidden' }, { status: 403 });
}
```

Add a comment referencing the asymmetry resolution (connect = manager+,
disconnect stays owner — deliberate: disconnect is more destructive).

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Full gates

**Verify**: `pnpm test` → all pass; `pnpm lint` && `pnpm format:check` → exit 0.

## Test plan

- No route harness yet (plan 015/016). Manual smoke for the operator: as a
  barber-role account, GET `/api/quickbooks/oauth/start` → 403
  `{"error":"forbidden"}`; as manager/owner → 302 redirect to Intuit (when
  `quickbooksConfigured()`); unauthenticated → 401.

## Done criteria

- [ ] `pnpm typecheck` exits 0; `pnpm test` exits 0
- [ ] `grep -n "ROLE_RANK" app/api/quickbooks/oauth/start/route.ts` → declaration + check present
- [ ] `grep -n "getShopMemberships" app/api/quickbooks/oauth/start/route.ts` → imported + used
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The google route's `ROLE_RANK`/membership idiom has changed shape (drift) —
  copy what's actually there, and note it.
- `getShopMemberships()`'s return shape doesn't include `shop_id`/`role` as
  assumed — read `lib/auth/server.ts` and adapt, reporting the delta.

## Maintenance notes

- If a third OAuth integration ever lands, extract a shared
  `requireManagerOfActiveShop()` helper for API routes instead of a third
  copy of this block (deliberately NOT done now — two copies don't justify the
  abstraction yet).
- Reviewer: confirm the 403 comes BEFORE any state cookie is set.
