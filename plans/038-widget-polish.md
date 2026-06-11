# Plan 038: Embeddable widget — good citizen, real ISR, brand pass-through, error states

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. Steps are
> mostly independent (the widget is a self-contained surface) — a reviewer may
> dispatch them as 2–3 contracts (perf / brand+a11y / errors). If anything in
> "STOP conditions" occurs, stop and report. When done, update this plan's row in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 9e6ce12..HEAD -- public/widget.js "app/[locale]/embed/[shopSlug]" "app/[locale]/(app)/settings/widget" app/api/widget/event/route.ts lib/business/widget-config.ts`
> Compare each "Current state" excerpt against the live code; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (the embed-ISR change must stay FOUC-free; the rest is additive/local)
- **Depends on**: none (self-contained surface; no file overlap with other plans).
- **Category**: bug / perf
- **Planned at**: commit `9e6ce12`, 2026-06-10

## Why this matters

The widget is the product's first impression on every salon's own website, and it's
leaking performance and brand:

- **The embed renders dynamically despite claiming 60s ISR**: `embed/[shopSlug]/page.tsx:19`
  sets `revalidate = 60`, but `:51 await props.searchParams` opts the route into
  request-time rendering — so every iframe impression = full SSR + ~7 Supabase queries,
  scaling with the host site's traffic, not bookings.
- **The funnel stats ship up to 20,000 raw rows to compute four numbers**
  (`settings/widget/page.tsx:43-48` `limit(20000)` + an in-memory rollup), and the cap
  silently truncates — wrong conversion numbers exactly when the widget succeeds.
- **widget.js taxes every host-page frame**: a `MutationObserver` on `documentElement`
  (`widget.js:353-356`) runs `mountAll()` (a full `querySelectorAll`) on every DOM
  mutation, never disconnects — harsh on SPA hosts.
- **Brand pass-through fails on its most visible pieces**: the floating button is
  hardcoded dark (`widget.js:185` `background:#111;color:#fff`), `Kua.open` is defined
  only after the async script evaluates so early "Book now" clicks throw with no queue
  (`widget.js:304`), and the locale defaults to `'fr'` ignoring the shop's saved default
  (`widget.js:307,323`).
- **Wallets are silently blocked**: `iframe.setAttribute('allow', '')` (`widget.js:129`)
  prevents Payment Request delegation, so Apple/Google Pay never surface in the embed
  payment step (they work on direct `/book`).
- **A broken shop renders the full-app 404/empty wizard inside the iframe** (UX-07), and
  the "Inter" widget font option is a dead control (CORRECTNESS-06 — only Geist is loaded).

## Current state

- `app/[locale]/embed/[shopSlug]/page.tsx:19,50-54` — `export const revalidate = 60;` then
  `const searchParams = await props.searchParams;` (the dynamic opt-in). `searchParams`
  carries `preview`, `theme`, `source`. `notFound()` on a bad slug → the app-wide
  `[locale]/not-found.tsx` renders INSIDE the iframe.
- `app/[locale]/(app)/settings/widget/page.tsx:43-67` — `widget_events` select with
  `limit(20000)` + JS rollup into `funnelStats`.
- `public/widget.js:120-131` — `createIframe`: `iframe.setAttribute('allow', '')`.
  `:138-156` — `bindResize` handles only `{kind:'resize'}`. `:179-191` — `.kua-fab`
  hardcoded `#111`/`#fff`. `:341-357` — `mountAll` + an undisconnected `MutationObserver`.
  `:303-312` — `window.Kua.open` defined post-eval (no command queue), locale default `'fr'`.
- `app/api/widget/event/route.ts:~62-69` (verify) — an `shops` select by alias on EVERY
  analytics POST (no cache).
- `lib/business/widget-config.ts:~70,271` (verify) — `font_family: z.enum(['system','geist','inter'])`
  emits `'Inter'`, but `app/[locale]/layout.tsx` loads only Geist via `next/font`, and the
  CSP `font-src 'self' data:` blocks an external fetch.
- `app/[locale]/embed/[shopSlug]/widget-resize-emitter.tsx` — emits `{kind:'resize', height}` only.

Conventions: widget.js is plain ES5-ish IIFE, zero-dep, `async`-loaded; a module-level
alias→id cache pattern exists in `middleware.ts:66-75`; theme is applied via an inline
pre-hydration script + CSS vars (`widgetThemeCss`). Per-segment `not-found.tsx`/`error.tsx`
are supported.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass (245) |
| Lint | `pnpm lint` | exit 0 |
| Format | `pnpm format:check` | exit 0 |
| Build (+ check route type) | `… pnpm build` | exit 0; embed route shows as ISR (not `ƒ Dynamic`) after Step 1 |

## Scope

**In scope**: `public/widget.js`, `app/[locale]/embed/[shopSlug]/*` (page + new
not-found/error + the resize emitter), `app/[locale]/(app)/settings/widget/page.tsx`,
`app/api/widget/event/route.ts`, `lib/business/widget-config.ts`, and `messages/{fr,en}.json`
if a new string is needed. A funnel-stats RPC migration (Step 2) under `supabase/migrations/`.

**Out of scope**: the booking wizard itself (plans 035/036 — `BookingWizard` is shared;
do not edit it here), the app-wide `not-found.tsx` (plan 037 owns token not-founds), CSP.

## Git workflow

- Branch: `advisor/038-widget-polish`. Commit per step; conventional commits, e.g.
  `perf(widget): make /embed genuinely ISR`, `fix(widget): theme the floating button`.
- Co-Authored-By footer. Do NOT push unless instructed.

## Steps

### Step 1: Make /embed genuinely ISR (PERF-01)

Stop awaiting `searchParams` in the page render path. Derive `theme` client-side from
`location.search` in the existing inline pre-hydration script (so it stays FOUC-free);
pass `source` from a small client component to the wizard's analytics; serve `preview=1`
from a separate non-cached route (e.g. `embed/[shopSlug]/preview/page.tsx`) used only by the
admin live-preview pane. The public page becomes ISR per `(locale, slug)`.

**Verify**: `pnpm build` → the embed route is listed as ISR/static, NOT `ƒ Dynamic`. The
admin preview still updates live; a themed widget shows no flash of the wrong theme.

### Step 2: Aggregate the funnel stats in SQL (PERF-03)

Add a migration with a `SECURITY INVOKER` RPC (or a view) that returns the grouped counts
(`event_type, source` → counts) for a shop over a window, and call it from
`settings/widget/page.tsx` instead of pulling ≤20k rows. Drop the `limit(20000)`.

**Verify**: `settings/widget` shows the same numbers with no row cap. Note the migration is
undeployed until the next prod deploy (like the other pending migrations) — record that.

### Step 3: Cache the analytics alias lookup (PERF-02)

In `app/api/widget/event/route.ts`, add a module-level `Map<alias,{id,expiresAt}>` (60s TTL),
mirroring `middleware.ts:66-75`, so the hot analytics endpoint doesn't query `shops` per event.

**Verify**: a renamed slug still resolves within ≤60s; no per-event `shops` query in the hot path.

### Step 4: Tame the MutationObserver (PERF-04)

Debounce `mountAll` (≤150ms trailing), check `mutation.addedNodes` for relevant elements
before scanning, and disconnect the observer once the page has been stable for N seconds (or
observe only `addedNodes`). Never run `querySelectorAll` on every frame.

**Verify**: on a mutation-heavy host (simulate repeated DOM changes), the widget does not
re-scan on every change.

### Step 5: Brand the FAB/modal + `Kua.open` command queue + saved locale (UX-05)

- Theme `.kua-fab` and the modal frame from the resolved config (accept `data-kua-button-color`
  and/or derive from the saved accent via a lightweight JSON endpoint; theme the modal surface
  from the resolved theme param) instead of hardcoded `#111`.
- Ship a command-queue stub so early clicks don't throw:
  `window.Kua = window.Kua || { q: [], open: function(){ this.q.push(arguments); } };` drained
  on load; document it in the embed snippet.
- Default the widget locale to the shop's saved `default_locale` when not explicitly passed.
- Add focus management to the modal (save `activeElement`, focus the close button, trap Tab,
  restore on close).

**Verify**: a light-themed widget shows a branded (not generic-dark) FAB/modal; an early
`Kua.open(...)` call works; Tab is trapped inside the open modal and focus restores on close.

### Step 6: Enable wallets + scroll-sync (DIRECTION-04 + UX-06)

- Set `iframe.allow = 'payment'` (`widget.js:129`) so Apple/Google Pay surface in the embed
  payment step (verify Stripe's PaymentElement uses it; confirm on iOS Safari with a
  deposit-enabled shop).
- Emit `{kind:'step-change'}` from the wizard's step effect via `widget-resize-emitter.tsx`;
  in `widget.js`, on that message call `iframe.scrollIntoView({block:'start', behavior:'smooth'})`
  (guarded by a viewport check) so mobile users aren't stranded mid-page on step change.

**Verify**: dev (embedded): advancing a step scrolls the iframe into view; the payment step
offers a wallet button where available.

### Step 7: Branded embed error/empty states + Inter (UX-07 + CORRECTNESS-06)

- Add `embed/[shopSlug]/not-found.tsx` + `error.tsx`: a compact "Réservation temporairement
  indisponible — appelez-nous" card (with phone when resolvable), NOT the app 404. Add an
  explicit empty state in the wizard wrapper when `services.length === 0 || barbers.length === 0`
  (do this in the EMBED wrapper, not the shared `BookingWizard`).
- Fix the dead Inter option: either load Inter via `next/font` for the embed/book layouts and
  wire the CSS var into `widgetThemeCss`, OR drop `'inter'` from the `widget-config.ts` enum
  and migrate saved configs to `'system'`.

**Verify**: a bad slug inside the iframe shows the salon-appropriate card; selecting "Inter"
either changes the font or the option is gone. `pnpm build` → exit 0.

## Test plan

- `lib/business/widget-config.test.ts` exists — if you change the font enum, update it. Add a
  test for the funnel RPC shape if the harness supports it.
- Manual matrix: embed is ISR; funnel numbers uncapped; FAB themed; early `Kua.open` works;
  modal focus-trapped; wallet button present; step-change scrolls; bad slug → branded card.
- `pnpm test` → 245 (+ any) pass.

## Done criteria

- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm build` exit 0; `pnpm test` exits 0
- [ ] Embed route is ISR (not Dynamic) in the build output
- [ ] `grep -n "limit(20000)" "app/[locale]/(app)/settings/widget/page.tsx"` → gone
- [ ] `grep -n "allow', ''" public/widget.js` → gone (now `'payment'`)
- [ ] FAB/modal themed from config; `Kua` command-queue stub present; modal focus-trapped
- [ ] `embed/[shopSlug]/not-found.tsx` + `error.tsx` exist
- [ ] No out-of-scope file modified (esp. the shared `BookingWizard`) (`git status`)
- [ ] `plans/README.md` row updated

## STOP conditions

- Removing `await searchParams` reintroduces a theme FOUC that the pre-hydration script can't
  prevent — STOP; the theme override needs a different carrier (report the constraint).
- The funnel RPC requires a schema change you can't express as a clean migration — STOP and
  ship the rest; note the stats fix as pending.
- `iframe.allow='payment'` breaks the embed CSP / Stripe element load — STOP and revert that
  one line; report.
- Editing the shared `BookingWizard` would be needed for the empty state — do it in the EMBED
  wrapper instead; if impossible, STOP.

## Maintenance notes

- **Reviewer**: confirm the embed build output flipped to ISR and that the live preview still
  works; confirm widget.js stays zero-dependency and `async`-safe.
- **Deferred**: the funnel RPC migration deploys with the next prod batch (track with the other
  pending migrations). A real per-day availability hint in the embed pairs with plan 042.
- widget.js is shipped to third-party sites — keep it tiny, dependency-free, and reduced-motion
  aware (wrap the FAB/skeleton keyframes in `@media (prefers-reduced-motion: no-preference)`).
