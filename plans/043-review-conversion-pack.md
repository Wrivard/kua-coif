# Plan 043: Review conversion pack — one-tap star deep-links, honest thank-you, Google handoff, a11y

> **Executor instructions**: Follow this plan step by step. Run every verification and
> confirm the expected result before moving on. If anything in "STOP conditions" occurs,
> stop and report. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 9e6ce12..HEAD -- "app/[locale]/review/[token]" lib/email/templates/review-request.tsx messages/fr.json messages/en.json`
> Compare each "Current state" excerpt against the live code; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW-MED (the Google-handoff "review gating" has a policy nuance — see Step 4)
- **Depends on**: plan 037 (added the token not-found landing). 043 owns ALL of
  `review/[token]/*` — file-disjoint from 037 (which deliberately left the review surface here).
- **Category**: direction
- **Planned at**: commit `9e6ce12`, 2026-06-10

## Why this matters

Review volume is a stated business driver (there's a QR feature + a `public_review_url`), but
the current flow is high-friction and the surface has correctness/a11y gaps:

- The request email has a single "Laisser un avis" CTA; the page ignores `searchParams` and the
  form starts at `rating=0` — so the path is open email → tap CTA → wait → tap a star → submit.
  Five tappable stars in the EMAIL that land pre-selected (`?rating=N`) cut on-page work to one
  tap.
- The thank-you state ALWAYS renders five filled gold stars regardless of the submitted rating
  (`review-form-client.tsx:71-74`) — a 2-star reviewer is shown 5 stars (reads as the salon
  inflating/ignoring their rating).
- A duplicate submission returns a generic error mapped to "link may have expired"
  (`actions.ts:75` → client `:58-61`) — a double-tapper is told their (saved) review failed.
- The star group violates the ARIA radio pattern (no roving tabindex / arrow keys,
  `review-form-client.tsx:119-141`) and the targets are ~40px (< 44px) on the page's one control.
- The thank-you is a dead end even though `shops.public_review_url` exists to collect Google
  reviews — routing happy reviewers onward turns first-party reviews into local-SEO reviews.

## Current state

- `app/[locale]/review/[token]/review-form-client.tsx:33` — `const [rating, setRating] = useState(0)`
  (no initial from props). `:40-64` — `submit()` → `submitPublicReview`; failure shows the
  "link may have expired" copy for ANY error. `:66-87` — thank-you state renders five
  `fill-warning` stars unconditionally. `:119-141` — `role="radiogroup"`/`role="radio"` on five
  `<button>`s, no `tabIndex`/`onKeyDown`; star `h-8 w-8 p-1`.
- `app/[locale]/review/[token]/actions.ts:68-75` — duplicate check: `if (existing) return err('INVALID_INPUT')`.
- `app/[locale]/review/[token]/page.tsx:22-31,74-79` — reads `params` (no `searchParams`);
  pre-checks an existing review; passes `shopName`, `barberName`, `alreadySubmitted` to the client.
  It already queries the `shops` row (`:62-66`) — add `public_review_url` there.
- `lib/email/templates/review-request.tsx:~83-98` (verify) — a single review CTA button.

Conventions: token pages are bilingual via an inline `isFr` map here (plan 041 migrates it
later — keep that pattern for now, just add keys consistently); the form posts via
`submitPublicReview`; `err(code, fieldErrors?)` carries field errors; `public_review_url` is the
shop's Google link (`marketing/reviews-qr`).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass (245) |
| Lint / Format | `pnpm lint` · `pnpm format:check` | exit 0 |
| Build | `… pnpm build` | exit 0 |

## Scope

**In scope**: `app/[locale]/review/[token]/review-form-client.tsx`, `…/page.tsx`, `…/actions.ts`,
`lib/email/templates/review-request.tsx`, `messages/{fr,en}.json` (if new keys needed).

**Out of scope**: the token not-found landing (plan 037), the i18n migration of this file to
next-intl (plan 041 — keep the inline `isFr` map shape), moderation (`/settings/reviews`).

## Git workflow

- Branch: `advisor/043-review-pack`. Commit per step; e.g.
  `feat(review): one-tap star deep-links from the request email`.
- Co-Authored-By footer. Do NOT push unless instructed.

## Steps

### Step 1: Star deep-links in the email + page reads `?rating=N`

In `review-request.tsx`, render five star LINKS to `/review/[token]?rating=N` (1..5) alongside
(or instead of) the single CTA. In `page.tsx`, accept `searchParams` and pass an `initialRating`
(clamped 1–5, else 0) to the client. In the client, seed `useState(initialRating)` — but still
require an explicit Submit (don't auto-submit from the URL; the customer may have mis-tapped).
Note: reading `searchParams` makes the page request-time rendered — it's already `force-dynamic`,
so no caching regression.

**Verify**: tapping the 4★ link in the email opens the form with 4 stars pre-selected and the
Submit button ready; submitting records rating=4.

### Step 2: Honest thank-you state (UX-04 part 1)

In the `submitted` view (`:66-87`), render the ACTUAL submitted rating (fill `rating` stars, not
always five). Thread the submitted rating into the thank-you render.

**Verify**: submitting 2★ shows two filled stars in the thank-you, not five.

### Step 3: Distinguish duplicate from expired (CORRECTNESS-07)

In `actions.ts`, return a distinct payload for the duplicate case (e.g.
`err('INVALID_INPUT', { review: 'already_submitted' })`). In the client failure branch, treat
`already_submitted` as success → flip to the thank-you state (the review IS saved) instead of the
"link expired" error.

**Verify**: double-submitting (or opening a second tab) shows "Avis reçu", not "link may have expired".

### Step 4: Google handoff on the thank-you (DIRECTION-02)

Pass `public_review_url` from `page.tsx` to the client. On the thank-you state, when present,
show a "Ça nous aiderait aussi sur Google →" link to it. POLICY NOTE: do not hard-gate (only
showing it to 4–5★ reviewers) — Google's policy frowns on review-gating; show the link to
everyone, optionally with stronger emphasis for high ratings. Document the choice in the PR.

**Verify**: the thank-you shows the Google link when the shop has a `public_review_url`.

### Step 5: Star group a11y + touch target (UX-04 part 2)

Make the star group a proper control: either drop the radio roles for plain `aria-pressed`
buttons, OR implement the ARIA radio pattern (roving `tabIndex`, ArrowLeft/Right to move +
select, single tab stop). Bump the hit area to ≥44px (e.g. `h-9 w-9` star + `p-1.5`, or a larger
button). Keep the hover-scale.

**Verify**: keyboard: arrows (or Tab+Enter) set the rating; the star buttons are ≥44px; screen
reader announces the control coherently.

## Test plan

- If `review/[token]/actions.test.ts` exists, add: a duplicate submission returns the
  `already_submitted` field error (not a bare `INVALID_INPUT`). Otherwise manual.
- Manual matrix: email star link pre-selects; thank-you echoes the real rating; duplicate →
  thank-you; Google link present; keyboard + 44px stars.
- `pnpm test` → 245 (+ any) pass.

## Done criteria

- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm build` exit 0; `pnpm test` exits 0
- [ ] Email has five star deep-links; page reads `?rating=N`; form pre-selects but requires Submit
- [ ] Thank-you echoes the actual rating; duplicate submit → thank-you (not error)
- [ ] Google handoff link shows when `public_review_url` is set (no hard review-gating)
- [ ] Star group is keyboard-operable and ≥44px
- [ ] No out-of-scope file modified (`git status`)
- [ ] `plans/README.md` row updated

## STOP conditions

- Auto-submitting from `?rating=N` is requested anywhere — DON'T; a mis-tapped email link must
  not post a review without an explicit Submit. If the spec demands auto-submit, STOP and confirm.
- `public_review_url` is not actually on the `shops` row queried here — verify; if absent, ship
  Steps 1–3 + 5 and report the missing field for Step 4.

## Maintenance notes

- **Reviewer**: confirm no hard review-gating (Google policy) and that the duplicate path reads as
  success.
- Plan 041 later migrates this file's inline `isFr` map to next-intl — keep new copy in the same
  inline shape so that migration is mechanical.
- A follow-up could record the email-link rating as an "intent" even if the user abandons before
  Submit (analytics) — out of scope here.
