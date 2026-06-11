# Plan 044: /me as a real hub — per-appointment Reschedule + Receipt links and cancel transparency

> **Executor instructions**: Follow this plan step by step. Run every verification and
> confirm the expected result before moving on. If anything in "STOP conditions" occurs,
> stop and report. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 9e6ce12..HEAD -- "app/[locale]/me/[token]" lib/security/signed-tokens.ts lib/business/barber-settings.ts messages/fr.json messages/en.json`
> Compare each "Current state" excerpt against the live code; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S-M
- **Risk**: LOW (signs tokens it already mints elsewhere; reads a policy it already resolves elsewhere)
- **Depends on**: **plan 037** — 037 edits `me/[token]/page.tsx` (effective loyalty balance) and
  this also edits it; run 037 FIRST, then this (sequential on `me/page.tsx`). Structurally fixes
  the emailed-reschedule-link-expiry problem (UX-01) by minting a fresh token on every /me render.
- **Category**: direction
- **Planned at**: commit `9e6ce12`, 2026-06-10

## Why this matters

The /me upcoming-appointment cards offer only **Cancel** (`me-client.tsx:239-246`). Customers who
can only cancel will cancel; salons prefer reschedules. The reschedule + receipt pages already
exist and their tokens are pure HMAC signs requiring no DB write (`signToken`), minted per
appointment elsewhere (`actions-public-links.ts:63-100`). The /me page (90-day token) renders
upcoming appointments server-side with everything needed — so it can mint a FRESH reschedule
token on every view, which also fixes the structural problem that the emailed 7-day reschedule
link is usually dead by the time plans change. Separately, the cancel dialog hides the refund
consequence until after the irreversible action (`me-client.tsx:186-192` is conditional-vague),
even though the server returns `minsCancelBefore` precisely so the client can show the threshold.

## Current state

- `app/[locale]/me/[token]/page.tsx:84-94` — the upcoming-appointments select (status in
  booked/confirmed, future, limit 10). It does NOT select `public_link_version`. The page builds
  an `upcoming[]` array passed to `<MeClient>`.
- `app/[locale]/me/[token]/me-client.tsx:211-251` — each upcoming card renders date/time/services
  + a single ghost **Cancel** button (`onClick={() => cancelAppointment(appt)}`).
- `me-client.tsx:183-192` — `cancelDescription` is vague ("Si tu es dans la fenêtre de
  remboursement, ton acompte te sera remboursé automatiquement") — the customer can't know whether
  they are inside the window. The page never fetches `barber_settings`.
- The token-minting pattern to copy (`actions-public-links.ts:63-100`):
  ```ts
  signToken({ kind: 'reschedule', resourceId: appt.id, expiresInSeconds: 60*60*24*7, ver: appt.public_link_version ?? 0 });
  signToken({ kind: 'receipt',    resourceId: appt.id, expiresInSeconds: 60*60*24*365, ver: appt.public_link_version ?? 0 });
  ```
- `me/[token]/actions.ts` resolves the policy via `resolveEffectiveBarberSettings(...)` +
  `mins_cancel_before_appt` + `customer_cancellations` (the same resolver the page can use to
  compute each appointment's refund cutoff).

Conventions: `signToken` from `lib/security/signed-tokens.ts`; tokens are URL path segments
(`/[locale]/reschedule/[token]`, `/receipt/[token]`); bilingual copy via the file's inline `isFr`
map (plan 041 migrates later — keep the pattern); refund cutoff = `start_at - mins_cancel_before_appt`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass (245) |
| Lint / Format | `pnpm lint` · `pnpm format:check` | exit 0 |
| Build | `… pnpm build` | exit 0 |

## Scope

**In scope**: `app/[locale]/me/[token]/page.tsx` (select `public_link_version`, resolve policy,
sign tokens), `app/[locale]/me/[token]/me-client.tsx` (Reschedule/Receipt buttons + refund-cutoff
copy), `messages/{fr,en}.json` if new keys are needed.

**Out of scope**: the effective loyalty balance (plan 037 — already done on `me/page.tsx`; build on
it), the i18n migration (plan 041), post-visit tipping from /me (a separate Stripe flow — NOT here),
any reschedule POLICY change (plan 037's deferred CORRECTNESS-04).

## Git workflow

- Branch: `advisor/044-me-hub`. Commit per step; e.g.
  `feat(me): per-appointment reschedule + receipt links`.
- Co-Authored-By footer. Do NOT push unless instructed.

## Steps

### Step 1: Sign per-appointment reschedule + receipt tokens (DIRECTION-01)

In `me/page.tsx`: add `public_link_version` to the upcoming select. For each upcoming appointment,
`signToken` a reschedule token (7d) and a receipt token (365d) using its `public_link_version`
(import `signToken` from `lib/security/signed-tokens`). Add `rescheduleToken` + `receiptToken` to
each item passed to `<MeClient>`.

**Verify**: `pnpm typecheck` → exit 0. The MeClient receives a fresh reschedule/receipt token per
upcoming row.

### Step 2: Render Reschedule (primary) + Receipt actions (DIRECTION-01)

In `me-client.tsx`, replace the single Cancel button row with: **Déplacer** (primary, a `Link` to
`/${locale}/reschedule/${rescheduleToken}`), **Reçu** (secondary `Link` to
`/${locale}/receipt/${receiptToken}`), and **Annuler** (the existing ghost cancel, now secondary).
Bilingual labels (inline `isFr` map, matching the file).

**Verify**: dev server (a /me with upcoming appts): each card shows Déplacer/Reçu/Annuler; the
links open the reschedule/receipt pages for that appointment.

### Step 3: Show the refund cutoff before cancelling (UX-03)

In `me/page.tsx`, resolve the cancellation policy per upcoming appointment's barber
(`resolveEffectiveBarberSettings` + `mins_cancel_before_appt`) and compute each appointment's
refund cutoff (`start_at - mins`). Pass it down. In `me-client.tsx`, render "Annulation gratuite
jusqu'au {date · heure}" on the card, and make the cancel ConfirmDialog DEFINITIVE: "Ton acompte
de X $ ne sera PAS remboursé" when inside the window, vs "ton acompte te sera remboursé" when
outside — based on the computed cutoff, not vague wording.

**Verify**: a paid appointment inside the no-refund window shows a clear "non remboursable"
message in the dialog; one outside shows the refundable message; the card shows the free-cancel
deadline.

## Test plan

- No new unit tests required (token signing + reads are covered by the signed-tokens + resolver
  suites). If a `me-client` test exists, assert the reschedule link renders. Manual otherwise.
- Manual matrix: per-appointment Déplacer/Reçu links work; refund cutoff shows; in/out-of-window
  dialog copy is correct.
- `pnpm test` → 245 pass.

## Done criteria

- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm build` exit 0; `pnpm test` exits 0
- [ ] Each upcoming card has working Reschedule + Receipt links (fresh tokens per render)
- [ ] `grep -n "public_link_version" "app/[locale]/me/[token]/page.tsx"` → present
- [ ] The cancel dialog states the refund consequence definitively (in vs out of window)
- [ ] No out-of-scope file modified (`git status`)
- [ ] `plans/README.md` row updated

## STOP conditions

- The upcoming appointment rows don't carry `barber_id` needed to resolve per-appointment policy —
  STOP; the cutoff computation needs it (the cancel action resolves by `appt.barber_id`, so the
  page select must include it).
- Signing a token requires a value the page doesn't have (e.g. `public_link_version` is null for
  legacy rows) — `?? 0` is the documented default; if a different default is needed, STOP.

## Maintenance notes

- **Reviewer**: confirm the reschedule token is minted FRESH per render (so it can't be the stale
  emailed one) and that the refund-cutoff copy matches the server's actual refund decision
  (`me/actions.ts` `withinNoRefundWindow`).
- This is the structural fix for the emailed-reschedule-link-expiry (UX-01): /me always offers a
  live link. Post-visit tipping from /me is a separate spike (needs a Stripe payment flow).
- Plan 037's deferred CORRECTNESS-04 (reschedule policy bypass / refund-dodge) interacts with the
  cutoff shown here — close that loop when the policy decision is made.
