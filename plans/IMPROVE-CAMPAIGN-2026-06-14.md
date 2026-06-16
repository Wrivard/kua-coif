# Improve Campaign — UI/UX/features deep-dive (2026-06-14)

Goal: deep-dive whole app → ~50 improvements → implement (autonomous). Audit = 3 read-only Explore lanes (A=UI/UX+a11y 14, B=features+flows 18, C=perf+reliability+i18n 17 = 49 raw). **The audit over-reports** — every item is verify-gated (worker confirms in-file before fixing; false-positives → SKIPPED). App already hardened (security/money 7 verticals + UI revamp), so focus = polish/a11y/perf/feature-gaps.

## REJECTED (false-positive / by-design — do NOT implement)
- **B4** Services lacks SearchBar — FALSE. services-client.tsx:261 renders `center={<SearchBar>}` + full filtering (86-141).
- **B5** Clients lacks SearchBar — FALSE. clients-client.tsx:394 renders it in PageHeader `center=` (+ server-side search for managers).
- **C15** revalidatePath not awaited — FALSE/by-design. `revalidatePath`/`revalidateTag` are synchronous in Next.js; not awaitable.
- **C17** services deposit_amount_cents multipleOf(1) — redundant; `.int()` already suffices (agent admits). Skip.

## SAFE — implement (verify-gated, no product decision needed)
Lane A (UI primitives + polish):
- A1 modal.tsx `<dialog>` missing aria-labelledby → id on h2 + aria-labelledby (VERIFIED real). [W1 Lia]
- A11 modal rounded-t-xl vs drawer rounded-t-2xl — consistency. [W1 Lia]
- A3 modal mobile max-width overflow — verify (likely non-issue). [W1 Lia]
- A7 data-table end-of-pagination CTA · A12 no-results density — minor, verify. [W1 Lia]
- A2/A6 row-actions touch-target <44px + spacing (WCAG 2.5.5) · A9 row-actions hover scale. [W2 — row-actions.tsx]
- A4 card.tsx CardHeader py-5→py-6 rhythm · A8 input.tsx required-asterisk → --danger token · A10 page-header text-[11px]→text-xs · A13 toggle.tsx label gap. [W2]
- A5 receipt-client.tsx:64 hardcoded #4f7d5e → var(--accent). [W2]
- A14 modal backdrop close announce — debatable a11y; likely SKIP.
Lane C (perf/reliability/types/i18n):
- C1 clients/page.tsx parallelize awaits · C2 clients/[id]/page.tsx same · C4 settings/shop select('*')→projection. [W1 Cole]
- C6 settings/loyalty/schema.ts multipleOf(0.01) · C7 settings/commissions/schema.ts .int() thresholds · C11 taxes/discounts/promo-codes actions `any`→typed. [W2/W3]
- C8 error.tsx + C9 loading.tsx for /barbers,/documentation,/marketing (NOT super-admin = Roan). [W3]
- C10 captureException around QuickBooks sync in (app)/actions.ts — **after Roan POS merges** (his file).
- C13 book/[shopSlug]/page.tsx generateMetadata hardcoded fr for en (BUG-07) — verify. [W3]
- C3 (app)/page.tsx:158 barbers select('*')→projection · C14 :206 clients select('*')→projection — **after Roan POS merges** (his file).
Lane B (small feature gaps):
- B10 barbers empty-state CTA · B11 products empty-state CTA. [W3 — barbers-client/products-client]
- B12 barbers CSV export (parity w/ clients) — borderline, M. [W3 or decision]
- B6 quick status-actions in appointment drawer — **Roan's file**, after POS; M.

## NEEDS-DECISION (surface to user, do NOT auto-decide)
- **B1/B2/B3 phantom features** (loyalty include_product_sales · use_prod_price_in_tips · commissions Products tab): wire vs remove = product call. (Some already hidden per W4 task 6440e863 — re-verify current state.)
- **C5 tu/vous register** in fr.json (~mixed): brand-voice call (defaulting either way rewrites dozens of strings).
- **B7 day-view · B8 week/list drag-reschedule · B9 bulk actions · B16 onboarding wizard**: large net-new features (L) with design forks — recommend, don't auto-build blind.
- **C12 force-dynamic on calendar page**: caching-semantics change, risky — needs deliberate decision/ADR.
- **B18 clients pagination (1000 cap) · C16 finances RANGE_LIMIT (5000)**: known perf-backlog; server-side pagination = M, deferred.
- **B13/B14/B15 POS-adjacent** (cash refund-at-counter, tips-at-counter, receipt auto-email after cash): fold into POS Stage 3 scope, after Roan's Stage 2/3.

## Wave plan + status
- W1 (dispatched): Roan=POS Stage 2 (re-dispatch IMPLEMENT) · Lia=A1/A11/A3/A7/A12 · Cole=C1/C2/C4.
- W2 (queued): row-actions/card/input/page-header/toggle/receipt (A2,A4,A5,A6,A8,A9,A10,A13) + schema/types (C6,C7,C11).
- W3 (queued): error/loading.tsx (C8,C9) · booking meta (C13) · empty states (B10,B11) · barbers CSV (B12).
- W4 (after Roan POS merges): C3,C14,C10,B6 (Roan's files).
- FINAL: report done vs the NEEDS-DECISION menu.

## ROUND-2 AUDIT findings (verified, higher signal than round-1)
Cole (calendar/booking/dashboard) — 11 items:
- R2-1 [HIGH] mobile: calendar day-nav (prev/today/next/date + live/stale) lives in PageHeader center `hidden sm:flex` → can't change day on phone. appointments-calendar.tsx:1021 / page-header.tsx:53. [W6 Cole]
- R2-2 [MED] List view has no paid indicator (grid+week show CreditCard glyph). appointments-list-view.tsx:50.
- R2-3 [MED] Create-RDV modal shows duration but never total PRICE during service pick. appointment-form-modal.tsx:335.
- R2-4 [MED] Empty barber filter → "Add RDV" opens form barber_id='' → zodResolver blocks submit, no error shown (dead "Réserver"). appointments-calendar.tsx:1104. [W6 Cole]
- R2-5 [MED] Booking step 4 "Confirmer" disabled w/ no reason when consent/Turnstile/first-name missing. booking-wizard.tsx:1366 (+canAdvance 660).
- R2-6 [LOW] Week view day headers non-clickable <div> (can't click day→day view). appointments-week-view.tsx:82.
- R2-7 [LOW] Barber chips no All/None affordance. appointments-calendar.tsx:1149. [W6 Cole]
- R2-8 [LOW] Drawer "Annuler" uses disabled not loading (no spinner; neighbor uses loading). appointment-detail-drawer.tsx:388.
- R2-9 [LOW] "Côte-à-côte" tab has no count badge (Week/List do). appointments-calendar.tsx:1127. [W6 Cole]
- R2-10 [LOW] Booking DateStrip shows weekday+num but no MONTH (ambiguous across month boundary). booking-wizard.tsx:1992.
- R2-11 [LOW] Reschedule date field no min (allows past date; Block-time has min). appointment-detail-drawer.tsx:469.
Lia round-2 (settings/finances/marketing) — PENDING.
W6 (Cole, in flight): R2-1/R2-4/R2-7/R2-9 (all appointments-calendar.tsx). Remaining R2 → next waves (view files, form-modal, drawer, booking-wizard — disjoint).
LESSON: mark read-only audit tasks `readOnly:true` to avoid Oryon's empty-branch rejection.
