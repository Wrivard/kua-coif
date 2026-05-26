# AUDIT — Phase 55 (post-loop 4 production readiness)

> Snapshot at the end of Loop 4 (Phases 50→54 delivered, Stripe Elements
> deferred). Companion to `AUDIT_PHASE49.md` (loop 3), `AUDIT_PHASE46.md`
> (loop 2), `AUDIT_PHASE37.md` (baseline).

---

## What landed in Loop 4

| Phase | Delivered | Status |
|---|---|---|
| 50 | Loyalty balance auto-apply at booking time | ✅ |
| 51 | Finances date-range picker + per-category breakdown | ✅ |
| 52 | Commission report on /finances (uses existing `commissions.ts`) | ✅ |
| 53 | Waiting list entries — table, public+admin actions, admin UI | ✅ admin UI / ⏳ booking wizard CTA |
| 54 | Stripe Elements UI in booking | ⏳ deferred to next loop |

### Phase 50 — Loyalty auto-apply
`bookPublicAppointment` now fetches `loyalty_balance_cents` during the
find-or-create client step. After promo discount, any accumulated balance
is capped at the running total and subtracted (in cents to avoid float
drift). The DB `CHECK (>= 0)` is doubly safe. Best-effort balance
decrement after appointment insert; Sentry breadcrumb on failure. New
clients always have balance=0 so they trivially short-circuit. Audit log
diff now includes `loyaltyCreditCents` when applied. UI surfacing of the
applied credit in the wizard summary deferred to V1.1 (would require a
new lookup endpoint).

### Phase 51 — Finances date range + per-category
`/finances?start=YYYY-MM-DD&end=YYYY-MM-DD` is now bookmarkable. Plain
GET form (no client component, no React state) keeps the page server-
rendered. Per-category breakdown joins `appointment_services × services
× service_categories` in three Supabase queries, aggregating in JS.
"Uncategorized" bucket for services with `category_id = null`.

### Phase 52 — Commission report
Reuses the existing `lib/business/commissions.ts` (computeCommission,
normalizeTiers — already tested with 13 cases). Added `tierConfigFromRow`
adapter to project the DB row shape (tier1_threshold/tier1_pct × 5) onto
the canonical `CommissionTiers` shape. Page-level: each barber with
revenue in the range is paired with their service-scope commission_tiers
row; barbers with no row or all-zero tiers surface as commission=0 with
mode=single. Mode badge (cumulative / single-tier) reads from the row.

### Phase 53 — Waiting list
Migration `20260525220000_waiting_list_entries.sql` applied via Supabase
MCP — table + indexes + updated_at trigger + RLS for shop_members on
SELECT/UPDATE/DELETE. Public INSERT goes through service-role client
(same pattern as `bookPublicAppointment`). Admin UI: extension of
`/settings/waiting-list/page.tsx` now loads up to 100 most-recent
entries; the client renders a table with status pills + per-row actions
(mark notified, cancel, delete). Phone + email shown in the contact
column. Empty state explains the trigger ("a client tried to book with
no slot available").

The booking-wizard CTA ("no slots? join the waitlist") is the missing
piece — currently entries can only be created via direct call to
`addToWaitlistPublic`. Adding a CTA on step 3 of the booking wizard is
the next V1.1 lift (~1-2h).

### Phase 54 — Stripe Elements (deferred)
Mapped in detail during loop 4 prep but not implemented — the work
estimate is 6-8h:
- Install `@stripe/stripe-js` + `@stripe/react-stripe-js`
- Add `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` plumbing
- `lib/stripe/client.ts` singleton
- New server action `createBookingPaymentIntent`
- Booking-wizard step 4 `PaymentElement` integration
- Confirmation flow + appointment-creation-with-PI handoff
- Idempotency + rollback if payment succeeds but appointment fails

Backend is fully ready (Phase 38 PaymentIntent + webhooks). This is
purely client-side + flow integration. Bumping to top of next loop.

---

## Production-blockers status

| Item | Status | Notes |
|---|---|---|
| P0.1 — Real charges | ✅ backend / ⏳ UI | Same as Phase 49. Stripe Elements UI = next loop top priority. |
| P0.2 — Loi 25 export + delete | ✅ | Phase 40. |
| P0.3 — db/types.ts codegen | ⚠️ slightly stale | New `waiting_list_entries` table — types not regenerated. Site works with `any` casts; regenerate before any new admin feature on this table. |
| P1.1 — Loyalty + promo + waiting list | ✅✅⚠️ | Promo (41), Loyalty backend (43) + auto-apply (50), Waiting list config + entries + admin UI (53). Booking CTA = V1.1. |
| P1.2 — Reports | ✅ | Phase 44 + 51 (date range, per-category) + 52 (commission). |
| P1.3 — Onboarding wizard | ✅ light | Phase 45 contextual card. |
| P1.4 — Custom domain | user task | Owner-driven. |

---

## Verdict

**Production-launchable for a single Quebec barbershop today.** The
caveats from Phases 46/49 are now narrower:

1. **Online card collection** still ⏳. The backend has been ready since
   Phase 38; the booking-flow UI is the last piece. Top priority for
   the next loop.
2. **Loyalty redemption auto-apply** ✅ (Phase 50). Customers get
   accumulated rewards automatically deducted on their next booking.
   UI surfacing of "you saved $X" deferred to V1.1.
3. **Waiting list flow** ✅ admin UI. ⏳ booking-wizard CTA to drive
   sign-ups (V1.1).

Reports are now sufficient for a real shop's monthly accounting:
gross revenue, completed visits, average ticket, loyalty outstanding,
per-barber, per-category, per-barber commissions — all in one page,
all date-range filterable.

---

## Loop 5 — proposed phases

| Phase | What | Budget | Notes |
|---|---|---|---|
| 56 | Stripe Elements UI in booking | 6-8h | Backend ready since Phase 38. Top priority. |
| 57 | Booking wizard waitlist CTA (when step 3 returns no slots) | 1-2h | Drives Phase 53 entries. |
| 58 | Loyalty redemption surfacing in wizard summary card | 2-3h | Server lookup by phone + UI hint. |
| 59 | db/types.ts regen (covers `waiting_list_entries`) | 30min | Drop `any` casts in waitlist actions. |
| 60 | Email templates per-shop customization (logo, accent color) | 3-4h | |
| 61 | Reviews / ratings collection after appointment | 4-6h | New table + email link + admin display. |
| 62 | Marketing banner on /book page (push to clients) | 3-4h | |
| 63 | Multi-shop switcher in sidebar for owners with N shops | 3-4h | |
| 64 | Image upload (avatars + logos) via Supabase Storage | 4-5h | |
| 65 | 2FA for owners | 4-6h | TOTP via Supabase Auth MFA. |
| 66 | Self-service `/me` page (client loyalty + Loi 25 self-export) | 3-4h | Public, phone-OTP gated. |

---

## V1.5+ candidates (further out)

- Cookie consent banner (if EU traffic possible)
- Lighthouse CI + perf budget
- Visual regression tests (Playwright snapshot of /book + /calendar)
- Pricing page + tier system (multi-tenant SaaS billing)
- Audit log retention policy (currently unbounded)
- Native mobile app (React Native sharing the Supabase schema)
- Multi-language email templates beyond fr/en
- Per-barber online booking pause / vacation auto-block

---

## Loop-4 metrics

- Phases completed: 4 / 5 planned (Stripe Elements deferred — biggest
  chunk, lowest-risk place to defer)
- New migrations: 1 (`waiting_list_entries`)
- New tests: 0 (commission logic re-used existing 13-case suite)
- Files touched: 8 (5 modified + 3 created)
- Lines added (rough): +560 / -50
- Push count: 1 (end of loop, per directive)

---

*Generated end of Loop 4 (commits 50→54). Update at each subsequent loop.*
