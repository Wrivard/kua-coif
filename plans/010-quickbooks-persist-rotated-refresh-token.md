# Plan 010: Persist the rotated QuickBooks refresh token on the sync path

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- lib/quickbooks/sync.ts app/api/cron/quickbooks-refresh/route.ts`
> On mismatch with the Current-state excerpts, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED (token persistence on an external integration — a wrong write
  bricks the connection instead of saving it; mitigate by mirroring the cron's
  proven block exactly)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

Intuit **rotates the refresh token** on refresh: the response carries a new
`refresh_token`, and the previous one stays valid only ~24 hours. The
completed-appointment sync path refreshes to get an access token but **throws
the rotated refresh token away** — its own comment admits it ("we don't here —
… trust the cron to update storage on its next tick"). But the daily cron only
refreshes tokens **within 14 days of expiry** (~100-day lifetime), so for ~86
days it never persists anything: after a sync-path rotation, the STORED token
dies within ~24h, the next refresh (sync or cron) gets `invalid_grant`, and
the shop flips to `disconnected` — QuickBooks silently dies until a manual
re-OAuth. Any shop completing appointments regularly hits this.

## Current state

- The bug — `lib/quickbooks/sync.ts:114-123` (at `ef34cee`):

```ts
// Refresh the token. Intuit rotates refresh tokens on every
// refresh, so we MUST persist the new one (we don't here — the
// cron in /api/cron/quickbooks-refresh handles the persistence
// path; on the sync path we use the new access_token but trust
// the cron to update storage on its next tick). Worst case: ...
const refreshed = await refreshQbToken(decrypt(shop.quickbooks_refresh_token_enc));
const accessToken = refreshed.access_token;
```

- The proven persistence block to mirror —
  `app/api/cron/quickbooks-refresh/route.ts:86-104`:

```ts
const tokenResponse = await refreshQbToken(currentRefreshToken);
const newRefreshEnc = encrypt(tokenResponse.refresh_token);
const newExpiresAt = new Date(
  Date.now() + tokenResponse.x_refresh_token_expires_in * 1000,
).toISOString();
const now = new Date().toISOString();
await admin
  .from('shops')
  .update({
    quickbooks_refresh_token_enc: newRefreshEnc,
    quickbooks_refresh_token_expires_at: newExpiresAt,
    quickbooks_last_refreshed_at: now,
  })
  .eq('id', shop.id);
```

- `encrypt`/`decrypt` come from `@/lib/crypto/aes` (the sync file already
  imports `decrypt` — check and add `encrypt`).
- The sync function already holds a service-role client and the `shop` row
  (id + token fields selected at the top of `pushAppointmentToQuickbooks`).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass |
| Lint/format | `pnpm lint` && `pnpm format:check` | exit 0 |

## Scope

**In scope**: `lib/quickbooks/sync.ts` only.

**Out of scope**: the cron route (already correct); `lib/quickbooks/server.ts`
(`refreshQbToken` — read-only; confirm its return type carries
`refresh_token` + `x_refresh_token_expires_in`); any disconnect-status logic.

## Git workflow

- Conventional commit: `fix(quickbooks): persist the rotated refresh token on the sync path`.
- Do NOT push unless instructed.

## Steps

### Step 1: Persist after the sync-path refresh

In `lib/quickbooks/sync.ts`, right after
`const refreshed = await refreshQbToken(...)` (:122), insert the cron's
persistence block adapted to local names (the supabase client variable in this
file + `shop.id` from the row already loaded). Keep it **best-effort but
loud**: wrap ONLY the persistence write in try/catch with
`captureException(e, { tags: { layer: 'quickbooks-sync', step: 'persist-rotated-token' } })`
— a persistence failure must not abort the receipt push (the access token in
hand is still valid), but it must never be silent. Then REWRITE the :114-121
comment to state the new truth (sync persists immediately; the cron remains
the near-expiry safety net).

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Confirm the response type

`grep -n "x_refresh_token_expires_in" lib/quickbooks/server.ts` — the
`refreshQbToken` return type must declare it. If it doesn't (type narrower
than the cron's usage), extend the type to match what the cron already
consumes — nothing else.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Full gates

**Verify**: `pnpm test` → all pass; `pnpm lint` && `pnpm format:check` → exit 0.

## Test plan

- No QB test harness exists (network OAuth). The machine gates + the mirrored
  proven block are the protection. Record for plan 015 (optional): a sync test
  with a mocked `refreshQbToken` asserting the shops update is issued with the
  encrypted new token.
- Operator verification post-deploy: complete an appointment on a QB-connected
  shop → `shops.quickbooks_last_refreshed_at` advances; the connection
  survives >24h of regular syncs.

## Done criteria

- [ ] `pnpm typecheck`, `pnpm test`, lint, format all exit 0
- [ ] `grep -n "quickbooks_refresh_token_enc" lib/quickbooks/sync.ts` → an
      UPDATE write exists on the sync path
- [ ] The stale "trust the cron" comment is gone/rewritten
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `refreshQbToken`'s response in `server.ts` doesn't expose the rotated
  token at all (would mean the cron types are casted around it) — report.
- The sync file's supabase client at that point is NOT service-role (it is —
  but if drift says otherwise, the shops write would be RLS-blocked; report).

## Maintenance notes

- Two refresh paths now both persist; if a third appears (e.g. a manual
  "test connection" button), it must persist too — consider centralizing a
  `refreshAndPersistQbToken(shopId)` helper at that point.
- Reviewer: check the catch wraps ONLY the persistence write, not the refresh
  itself (a refresh failure must keep the existing error handling).
