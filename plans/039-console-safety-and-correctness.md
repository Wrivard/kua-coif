# Plan 039: Back-office safety — destructive-action guards, false signals, payroll correctness

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. Each step
> is independent (distinct files) — a reviewer may dispatch them as two contracts
> (destructive-confirmations vs data-correctness). If anything in "STOP conditions"
> occurs, stop and report. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 9e6ce12..HEAD -- "app/[locale]/(app)/appointments-grid.tsx" "app/[locale]/(app)/appointments-week-view.tsx" "app/[locale]/(app)/clients/clients-client.tsx" "app/[locale]/(app)/settings/commissions/commissions-client.tsx" "app/[locale]/(app)/settings/audit-log/page.tsx" "app/[locale]/(app)/settings/notifications/notifications-client.tsx" "app/[locale]/(app)/marketing/review-campaign/review-campaign-client.tsx" "app/[locale]/(app)/marketing/winback/winback-client.tsx" lib/nav-items.ts`
> Compare each "Current state" excerpt against the live code; on a mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: S-M
- **Risk**: LOW-MED (one money-correctness fix — commissions; the rest are guards/labels)
- **Depends on**: **plan 032** edits `notifications-client.tsx` (optimistic toggle) — run
  032 first or rebase Step 5. Otherwise independent.
- **Category**: bug
- **Planned at**: commit `9e6ce12`, 2026-06-10

## Why this matters

Several back-office actions are one mis-click or one stale-state away from real damage,
and two screens lie to the operator:

- **Anonymize fires with zero confirmation**, one icon away from Delete — and it's an
  irreversible Loi 25 PII scrub (`clients-client.tsx:221-230`).
- **The commissions "cumulative" flag silently rewrites every barber's payroll mode** and
  ignores the scope tab (`commissions-client.tsx:79-84,109`) → wrong payouts.
- **Campaign sends use a native `confirm()` then `window.location.reload()`** that wipes
  the success/partial-failure toast (`review-campaign-client.tsx:110,133`) — the operator
  loses the "N failed" feedback on an irreversible bulk SMS/email send.
- **The paid-icon renders on every calendar block** regardless of payment status
  (`appointments-grid.tsx:492`) — a false "collected" signal on the busiest screen.
- **The audit-log query has no shop scope** (`audit-log/page.tsx:37-41`) — a multi-shop
  owner sees all shops interleaved and the 100-row cap can hide the active shop's entries.
- **Finances ships a permanent fake notification dot** (`nav-items.ts:60` `notif: true`) —
  cries wolf forever.

## Current state

- `app/[locale]/(app)/appointments-grid.tsx:492` — `<CreditCard … className="… text-success" />`
  rendered UNCONDITIONALLY. The twin `appointments-week-view.tsx:~172` has the same. The
  block's `CalendarAppointment` carries `payment_status` (used in the drawer).
- `app/[locale]/(app)/clients/clients-client.tsx:221-230` — `onAnonymize` runs
  `anonymizeClient` immediately, no ConfirmDialog (Delete and Merge in this file DO use one).
  The `onRevokeMe` handler nearby is also unconfirmed.
- `app/[locale]/(app)/settings/commissions/commissions-client.tsx:79-84` —
  `initialCumulative = useMemo(majority…, [scope])`, `const [cumulative, setCumulative] = useState(initialCumulative)`
  (state never re-inits on scope change). `:103-124` — `onSave` stamps the single
  `cumulative` boolean onto EVERY barber row of the scope.
- `app/[locale]/(app)/settings/audit-log/page.tsx:37-41` — `sb.from('audit_log').select(…).order(…).limit(100)`
  with NO `.eq('shop_id', …)`. (Other pages resolve the active shop via `lib/auth/server.ts`.)
- `app/[locale]/(app)/marketing/review-campaign/review-campaign-client.tsx:110,133` —
  `if (!confirm(…)) return;` then `window.location.reload()` after the toast. `winback-client.tsx`
  has the identical pair.
- `app/[locale]/(app)/settings/notifications/notifications-client.tsx:153` —
  `if (!confirm(t('confirmDisconnect'))) return;` (SMTP wipe). A second one wipes Twilio.
- `lib/nav-items.ts:60` — `{ href: '/finances', …, notif: true }` (static; nothing computes/clears it).

Conventions: destructive actions use `components/ui/confirm-dialog.tsx` `<ConfirmDialog>`
(see Delete in `clients-client.tsx`); a `router.refresh()` (not `window.location.reload()`)
re-runs the server component while keeping the toast; active shop via `getCurrentShopId()`
(`lib/auth/server.ts`); i18n in `messages/{fr,en}.json`, both required.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass (245); i18n-parity green |
| Lint | `pnpm lint` | exit 0 |
| Format | `pnpm format:check` | exit 0 |
| Build | `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key pnpm build` | exit 0 |

## Scope

**In scope** (each independent): `appointments-grid.tsx` + `appointments-week-view.tsx`
(CAL-01); `clients/clients-client.tsx` (CLI-01); `settings/commissions/commissions-client.tsx`
(SET-01/02); `settings/audit-log/page.tsx` (SET-03); `marketing/review-campaign/review-campaign-client.tsx`
+ `marketing/winback/winback-client.tsx` (MKT-01); `settings/notifications/notifications-client.tsx`
(SET-04); `lib/nav-items.ts` (X-01); `messages/{fr,en}.json`.

**Out of scope**: the optimistic notification toggle (plan 032 — coordinate on the shared
file), Callout adoption (plan 030), the commissions dirty-state guard beyond what SET-02
needs (port from `barber-settings-client.tsx` if cheap, else note), any server-action change
except adding the audit-log shop filter.

## Git workflow

- Branch: `advisor/039-console-safety`. Commit per finding; conventional commits, e.g.
  `fix(clients): confirm before the irreversible anonymize`, `fix(commissions): stop rewriting every barber's payroll mode`.
- Co-Authored-By footer. Do NOT push unless instructed.

## Steps

### Step 1: Gate the paid-icon on payment_status (CAL-01)

Wrap the `<CreditCard … />` render in both `appointments-grid.tsx:492` and
`appointments-week-view.tsx` in `appointment.payment_status === 'paid' ? … : null`. Add an
`sr-only` "payé/paid" label since the glyph is currently `aria-hidden`.

**Verify**: dev server: only paid appointments show the green card icon. `pnpm typecheck` → exit 0.

### Step 2: Confirm before anonymize + revoke-me (CLI-01)

Route `onAnonymize` (and the unconfirmed `onRevokeMe`) through the file's existing
ConfirmDialog state machine (model the Delete/Merge wiring), with the client name
interpolated and `destructive` styling for anonymize. New i18n keys for the dialog copy
(both locales).

**Verify**: dev server: clicking the anonymize icon opens a confirm dialog; cancelling does
nothing. `grep -n "anonymizeClient" clients-client.tsx` → now reached only via the dialog confirm.

### Step 3: Fix the commissions cumulative correctness (SET-01/02)

Make `cumulative` per-row (a Toggle in the matrix, preserving the DB's per-barber
`cumulative` column) so a save never flattens mixed modes — OR, as the minimum, re-initialize
the page-level state when `scope` changes (`useEffect(() => setCumulative(initialCumulative), [scope])`)
AND include `cumulative` only for rows the user actually touched. Prefer per-row; the
`/finances` report renders a per-barber mode badge, so mixed modes are an expected state.
While here, port the dirty-state guard (Reset + `beforeunload`) from `barber-settings-client.tsx`
if straightforward (SET-02).

**Verify**: dev server: switching Services↔Products no longer carries the toggle; saving a
shop with mixed per-barber modes does not flatten them. `pnpm typecheck` → exit 0.

### Step 4: Scope the audit-log query to the active shop (SET-03)

Add `const shopId = await getCurrentShopId()` (or the repo's resolver) and `.eq('shop_id', shopId)`
to the `audit_log` query (`page.tsx:37-41`). Verify `audit_log` rows carry `shop_id`
(`logDurableAudit` writes it). While here, the expandable rows are mouse-only — add
`role="button"`/`tabIndex`/Enter+Space to the `<tr onClick>` if trivial (audit-log-client.tsx).

**Verify**: dev server (multi-shop owner): the page shows ONLY the active shop's entries.
`grep -n "shop_id" audit-log/page.tsx` → present.

### Step 5: Campaign confirm dialog + keep the result toast (MKT-01)

In `review-campaign-client.tsx` and `winback-client.tsx`: replace `confirm()` with
`<ConfirmDialog>` (count + channel summary in the body) and replace `window.location.reload()`
with `router.refresh()` so the success/partial-failure toast survives. New i18n keys.

**Verify**: dev server: sending shows a themed confirm; after send, the "N sent / M failed"
toast stays visible (no reload). `grep -rn "window.location.reload" marketing/` → no matches.

### Step 6: Notifications disconnect confirm (SET-04)

Replace both `confirm(...)` calls in `notifications-client.tsx` (SMTP + Twilio disconnect)
with `<ConfirmDialog>` (model the barbers-client Google-disconnect dialog). Coordinate with
plan 032 if it already restructured this file.

**Verify**: `grep -n "confirm(" notifications-client.tsx` → no native confirms remain.

### Step 7: Remove the fake finances notification dot (X-01)

Delete `notif: true` from the finances entry in `lib/nav-items.ts:60`.

**Verify**: dev server: no red dot on Finances. `grep -n "notif" lib/nav-items.ts` → gone.

## Test plan

- If `commissions` or `clients` has a client test, add: anonymize requires confirm;
  saving commissions preserves a non-toggled row's `cumulative`. Otherwise manual.
- Manual matrix per step above. `pnpm test` → 245 pass, i18n-parity green with new keys.

## Done criteria

- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm build` exit 0
- [ ] `pnpm test` exits 0 (245); i18n-parity green
- [ ] Paid icon gated; anonymize/campaign/notifications confirm via `<ConfirmDialog>`
- [ ] Commissions: scope switch doesn't carry the flag; mixed modes preserved
- [ ] `grep -n "shop_id" "app/[locale]/(app)/settings/audit-log/page.tsx"` → present
- [ ] `grep -rn "window.location.reload" "app/[locale]/(app)/marketing"` → no matches
- [ ] `notif: true` removed from `lib/nav-items.ts`
- [ ] No out-of-scope file modified (`git status`)
- [ ] `plans/README.md` row updated

## STOP conditions

- `audit_log` rows do NOT carry `shop_id` — STOP (the scoping needs a schema check; don't
  add a filter on a missing column).
- The commissions per-row cumulative change touches `saveCommissions`'s signature or the DB
  shape in a way that affects the `/finances` report — STOP and report (ship the safe re-init
  minimum instead).
- A ConfirmDialog swap drops a side-effect the native `confirm()` gated (focus, a second
  prompt) — preserve it.

## Maintenance notes

- **Reviewer**: scrutinize Step 3 (money) hardest — confirm a mixed-mode shop survives a save.
  Confirm `router.refresh()` (not reload) everywhere so toasts persist.
- **Deferred**: the finances `notif` prop could later be driven by a real signal (e.g.
  disputes `needsResponse > 0`) — that's the feature that justifies the prop; file separately.
- Plan 030's Callout should be adopted in `notifications-client.tsx` / `finances` when those
  files are next touched.
