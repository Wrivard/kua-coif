# AUDIT — Phase 46 (post-loop 2 production readiness)

> Snapshot of the app's state at the end of Loop 2 (Phases 42-45 delivered).
> Companion to `AUDIT_PHASE37.md` which captured the pre-loop state.

---

## What landed in Loop 2

| Phase | Delivered | Status |
|---|---|---|
| 36 | Premium dark-theme overhaul (palette, elevation, components) | ✅ |
| 37 | Production-readiness audit doc | ✅ |
| 38 | Stripe PaymentIntent backend (charges + refunds + webhook events) | ✅ backend / ⏳ UI |
| 39 | db/types.ts codegen from live schema | ✅ |
| 40 | Loi 25 data export + anonymize | ✅ |
| 41 | Promo codes activation in booking | ✅ |
| 42 | Service deposit_amount admin field | ✅ |
| 43 | Loyalty program activation on appointment completion | ✅ backend / ⏳ UI |
| 44 | Finances dashboard (KPIs + sales-per-barber) | ✅ |
| 45 | Onboarding hint card on calendar | ✅ |

## Production-blockers status

The 3 P0s from AUDIT_PHASE37 are now:

- **P0.1 — Real charges**: ✅ backend (Phase 38). ⏳ Stripe Elements UI in booking still V1.1.
- **P0.2 — Loi 25 export + delete**: ✅ (Phase 40)
- **P0.3 — db/types.ts codegen**: ✅ (Phase 39)

P1 items from AUDIT_PHASE37 are now:

- **P1.1 — Loyalty + promo + waiting list**: ✅ promo (Phase 41) + ✅ loyalty backend (Phase 43). ⏳ waiting list logic + ⏳ loyalty redemption UI.
- **P1.2 — Reports**: ✅ basic (Phase 44). Date picker + per-category + commission report = V1.5.
- **P1.3 — Onboarding wizard**: ✅ light version (Phase 45) — contextual card instead of full wizard. Full wizard with multi-step flow can be V1.5.
- **P1.4 — Custom domain**: still user task.

---

## Verdict

The app is **production-launchable for a single Quebec barbershop today** with these caveats:

1. **No online card collection yet** — clients still pay at the shop. The Stripe Connect onboarding works, the PaymentIntent backend works, but the booking-flow card form (Stripe Elements) is V1.1. Shops can still operate (admin-mediated payment).
2. **Loyalty redemption is manual** — the counter and balance bump correctly on appointment completion, but applying that balance as a discount on the next booking requires a manager to enter it manually as a promo-style adjustment. Auto-apply is V1.1.
3. **Waiting list table exists but no flow** — clients can't yet add themselves to a waitlist when no slot is available. V1.1.

Everything else (calendar, booking, email, Google sync, Stripe Connect onboarding, QuickBooks onboarding, Loi 25, reports) is fully functional.

---

## V1.1 phases (next loop, when business need surfaces)

| Phase | What | Budget |
|---|---|---|
| 47 | Stripe Elements UI in booking flow (PCI-compliant card form) | 6-8h |
| 48 | Loyalty balance redemption on booking (auto-apply discount) | 2-3h |
| 49 | Waiting list flow (add when full + notify when slot opens) | 4-6h |
| 50 | Date-range picker + per-category breakdown on /finances | 3-4h |
| 51 | Commission report (against commission_tiers) | 4-5h |
| 52 | Service category UI improvements (drag-reorder, color coding) | 2-3h |
| 53 | Email templates per-shop customization (logo, colors) | 3-4h |
| 54 | Reviews / ratings collection after appointment | 4-6h |
| 55 | Marketing/announcement feature (push to /book page banner) | 3-4h |
| 56 | Multi-shop switcher for users with access to multiple shops | 3-4h |

---

## V1.5+ candidates (further out)

- Image upload (avatars + logos) via Supabase Storage
- 2FA for owners
- Self-service `/me` page for clients (loyalty + Loi 25 self-export)
- Cookie consent banner (if EU traffic possible)
- Lighthouse CI + perf budget
- Visual regression tests
- Pricing page + tier system (multi-tenant SaaS billing)

---

*Generated end of Loop 2 (commits 36→45). Update at each subsequent loop.*
