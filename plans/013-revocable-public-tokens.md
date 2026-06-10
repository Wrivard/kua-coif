# Plan 013: Versioned, revocable receipt / review / reschedule tokens

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- lib/security/signed-tokens.ts "app/[locale]/(app)/actions-public-links.ts" "app/[locale]/receipt" "app/[locale]/review" "app/[locale]/reschedule" supabase/migrations db/rows.ts`
> On mismatch with the Current-state excerpts, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW-MED (legacy tokens must keep working — `ver` absent ⇒ treated as 0; the migration defaults the column to 0, so nothing is invalidated at deploy)
- **Depends on**: none. Conflicts: plan 007 touched `actions-public-links.ts`; rebase by content.
- **Category**: security
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

A `receipt` token is a bearer credential to an appointment's details for
**365 days**, a `review` token for 90 — and neither is revocable: the `ver`
revocation mechanism exists but is wired ONLY for `me` tokens
(client-scoped `me_token_version`, Clients-audit W5c). A receipt/review link
forwarded, leaked through an email gateway, or pasted somewhere public stays
valid for up to a year, and the only kill switch is rotating
`NOTIFICATION_ENCRYPTION_KEY` — which would break SMTP/Twilio/Google/QB
credential decryption globally. This plan extends the existing version
mechanism to the three appointment-scoped kinds with a per-appointment
version column and a one-click revoke.

## Current state

(all at `ef34cee`)

- `lib/security/signed-tokens.ts` — generic and READY: `TokenPayload.ver?:
  number` ("currently `me` only" by convention, :43-48); `signToken` embeds
  `ver` when passed (:80-88); `verifyToken` returns the payload — **the ver
  COMPARISON is the caller's job** (that's how /me does it).
- `app/[locale]/(app)/actions-public-links.ts` — `generatePublicLinks` mints:
  review 90d (:62-66, no ver), me 90d (:80-85, WITH ver from
  `clients.me_token_version` — the exemplar), receipt 365d (:87-91, no ver),
  reschedule 7d (:92-96, no ver). Plan 007 may have swapped its
  `logAuditAction` → `logDurableAudit` (:110) — expected.
- The me-exemplar version flow to copy: mint reads
  `clients.me_token_version` (:72-79); the verify sites compare
  `payload.ver ?? 0` against the CURRENT version and reject on mismatch —
  locate them with `grep -rn "me_token_version" "app/[locale]/me"` and mirror
  the comparison idiom exactly.
- Verify sites for the three kinds (locate with
  `grep -rn "verifyToken(" app | grep -v me`):
  `app/[locale]/receipt/[token]/…`, `app/[locale]/review/[token]/actions.ts`
  (+ its page), `app/[locale]/reschedule/[token]/actions.ts` (+ its page).
  Every one must add the version check.
- Email/SMS mint sites OTHER than generatePublicLinks also sign these kinds —
  enumerate with `grep -rn "kind: 'receipt'\|kind: 'review'\|kind: 'reschedule'" app lib`
  (e.g. `lib/business/review-request.ts` mints review tokens; receipt links
  appear in confirmation emails). EVERY mint site must embed the version.
- DB: `appointments` has no version column yet. Migration pattern for
  defaulted columns: see `20260609140000_clients_me_token_version.sql`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass (signed-tokens tests exist: `lib/security/signed-tokens.test.ts` — 9 cases incl. ver round-trip) |
| Lint/format | `pnpm lint` && `pnpm format:check` | exit 0 |

## Scope

**In scope**:
- New migration `supabase/migrations/20260610120000_appointments_public_link_version.sql`
- `app/[locale]/(app)/actions-public-links.ts` (embed ver ×3 + new revoke action — may live in a sibling file if cleaner)
- Every mint site found by the grep above
- The receipt/review/reschedule verify sites
- `app/[locale]/(app)/appointment-detail-drawer.tsx` (a "Revoke public links" row, manager+)
- `db/rows.ts` (if the AppointmentRow type lives there), `messages/fr.json` + `messages/en.json` (button + toast keys)

**Out of scope**:
- `me`/`unsub` tokens (already versioned / client-scoped).
- Changing TTLs: keep receipt 365d (tax-records rationale documented at the
  mint site), review 90d, reschedule 7d — revocability is the fix, not shorter
  windows. If the operator wants shorter TTLs it's a one-line follow-up.
- `lib/security/signed-tokens.ts` itself — NO changes needed (mechanism is generic).

## Git workflow

- Conventional commit: `feat(security): revocable receipt/review/reschedule tokens (per-appointment version)`.
- Do NOT push unless instructed.

## Steps

### Step 1: Migration

```sql
alter table public.appointments
  add column if not exists public_link_version integer not null default 0;
comment on column public.appointments.public_link_version is
  'Revocation version embedded in receipt/review/reschedule signed tokens; bump to invalidate all outstanding links for this appointment.';
```

**Verify**: file exists; idempotent (`if not exists`).

### Step 2: Embed the version at every mint site

In `generatePublicLinks`: the appointment select already runs — add
`public_link_version` to its columns, then pass
`ver: appt.public_link_version ?? 0` to the THREE `signToken` calls (review,
receipt, reschedule). Then fix every other mint site found by the grep the
same way (each already loads or can load the appointment row — extend the
select rather than adding a query where possible).

**Verify**: `grep -rn "kind: 'receipt'" app lib` → every match has a `ver:` in
the same call (paste in report); same for review + reschedule. `pnpm typecheck` → exit 0.

### Step 3: Enforce at every verify site

At each receipt/review/reschedule verify site: the handler already loads the
appointment row — add `public_link_version` to that select and reject exactly
like /me does (`(payload.ver ?? 0) !== (appt.public_link_version ?? 0)` →
the site's NOT_FOUND/invalid-token path, NOT a distinct error that would
confirm the appointment exists).

**Verify**: `grep -rn "public_link_version" app | measure` → ≥ 6 sites
(3 mint groups + 3 verify groups). `pnpm typecheck` → exit 0.

### Step 4: Revoke action + drawer row

Add `revokePublicLinks` (withAction, `minRole: 'manager'`, schema
`{ appointment_id: uuid }`): verify the appointment belongs to `ctx.shopId`
(`.eq('shop_id', ctx.shopId)` on the read — copy `generatePublicLinks`'s
ownership shape), increment `public_link_version`, write a
`logDurableAudit` row (`action: 'update'`, diff
`{ public_links_revoked: true }`). In the drawer, add a row action
"Révoquer les liens publics" next to the existing link-generation control,
gated the same way the refund affordance is manager-gated (`canManageMoney`
prop or its sibling — match the existing pattern), with a ConfirmDialog and
toast. i18n keys in BOTH locales (the parity test enforces).

**Verify**: `pnpm vitest run tests/i18n-parity.test.ts` → pass;
`pnpm typecheck` → exit 0.

### Step 5: Tests + gates

Extend `lib/security/signed-tokens.test.ts` is NOT needed (ver round-trip
already covered). Add nothing speculative. Run:

**Verify**: `pnpm test` → all pass; `pnpm lint` && `pnpm format:check` &&
`pnpm build` → exit 0.

## Test plan

- Covered: token ver mechanics (existing 9 tests). The verify-site comparisons
  get integration coverage with plan 015 (record: receipt with stale ver →
  not-found; post-revoke review link → rejected; legacy no-ver token with
  version 0 → ACCEPTED).
- Operator smoke after deploy: generate links on an appointment → open the
  receipt → revoke from the drawer → the same receipt link now 404s; newly
  generated links work.

## Done criteria

- [ ] Migration file exists (idempotent, commented)
- [ ] Greps from steps 2–3 pass (output in report)
- [ ] Revoke action exists with shop-ownership check + durable audit
- [ ] i18n parity test passes
- [ ] `pnpm typecheck`, `pnpm test`, lint, format, build all exit 0
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- A mint site signs receipt/review/reschedule WITHOUT an appointment row in
  reach (would force an extra query per email send) — report the site and its
  call volume instead of silently adding N+1 queries.
- The receipt page renders WITHOUT loading the appointment row (purely
  token-derived) — then there's nothing to compare against; report.
- Legacy-token behavior: if any verify site already rejects `ver`-less tokens
  for other kinds, the "absent ⇒ 0" convention is broken somewhere — report.

## Maintenance notes

- Anonymization note: `anonymizeClient` should arguably bump
  `public_link_version` on the client's appointments (kills outstanding links
  to anonymized data) — flagged as a follow-up, NOT done here (touches the
  Loi 25 path; needs its own review).
- New token kinds must decide their version scope (client vs appointment) at
  design time; "no revocation" is no longer an acceptable default.
- After the migration deploys, regenerate db/types.ts (plan 023 sweeps).
