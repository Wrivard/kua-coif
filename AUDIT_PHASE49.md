# AUDIT — Phase 49 (post-loop 3 production readiness)

> Snapshot of the app's state at the end of Loop 3 (Phases 46→48 delivered).
> Companion to `AUDIT_PHASE46.md` (end of Loop 2) and `AUDIT_PHASE37.md`
> (pre-loop baseline).

---

## What landed in Loop 3

The user's directive at the start of this loop was qualitative, not feature-driven:
*"ça a l'air plus high end que l'image que je t'envoye"* + *"use your frontend
plugin to construct the best frontend ever"* + a calendar-specific *"je n'aime
pas les white stroke"*. The loop pivoted from the Phase 46 V1.1 feature roadmap
to a UX polish track.

| Phase | Delivered | Status |
|---|---|---|
| 46 | Audit + roadmap doc | ✅ |
| 47 | Premium UX polish — auth shell, booking wizard, EmptyState, forms | ✅ |
| 48 | Calendar grid white-stroke root-cause fix (border tokens) + overlay polish | ✅ |

The V1.1 feature roadmap from Phase 46 (Stripe Elements UI, loyalty redemption,
waiting list flow, etc.) was deferred — those are still V1.1, see below.

---

## Phase 48 root-cause find — worth highlighting

A subtle Tailwind bug had been shipping since Phase 33: `border-border/X`
opacity modifiers were silently no-ops because `--border` is defined as
`rgba(255, 255, 255, 0.08)` and Tailwind 3 cannot strip the baked-in alpha
to apply a modifier. **Every grid line was rendering at the same 0.08 alpha**
regardless of `/8`, `/20`, `/25`, `/40`. Two rounds of "softer grid" work in
Phase 33 had no actual visual effect.

Fix: two new alpha-baked tokens (`--border-soft: 0.04`, `--border-faint: 0.025`)
registered as `border-soft` / `border-faint`. Same bug affected one stray
`border-border/60` in the booking wizard — also fixed. Comments in `globals.css`
explain why `/X` modifiers must not be reintroduced on `border-*` colors.

**Future-proofing**: any new `--*` token defined as `rgba()` should follow the
named-step pattern. Tokens defined as hex (`--accent: #8b5cf6`) accept `/X`
modifiers fine.

---

## Production-blockers status

Re-checking the P0/P1 from `AUDIT_PHASE37.md`:

| Item | Status | Notes |
|---|---|---|
| P0.1 — Real charges | ✅ backend / ⏳ UI | Stripe PaymentIntent + webhooks ship since Phase 38. Stripe Elements card form in booking still V1.1. |
| P0.2 — Loi 25 export + delete | ✅ | Phase 40. |
| P0.3 — db/types.ts codegen | ✅ | Phase 39. |
| P1.1 — Loyalty + promo + waiting list | ⚠️ partial | Promo (41) ✅, Loyalty backend (43) ✅, Waiting list logic ⏳, Loyalty redemption UI ⏳. |
| P1.2 — Reports | ⚠️ partial | Basic finances (44) ✅, date-range + commission report ⏳. |
| P1.3 — Onboarding wizard | ✅ light | Phase 45 contextual card; full wizard remains V1.5. |
| P1.4 — Custom domain | user task | Vercel-level, owner-driven. |

No P0/P1 regressions introduced in Loop 3.

---

## Verdict

**Production-launchable for a single Quebec barbershop today**, with the same
three caveats as Phase 46 (online card collection ⏳, loyalty redemption ⏳,
waiting list ⏳).

What's *new* since Phase 46:
- UX quality has moved from "functional dark theme" to "designed dark theme"
  on the highest-traffic surfaces (login, booking, calendar).
- The calendar grid bug-fix removed a long-standing source of "this feels
  cheap" — the white strokes were quietly degrading the polish ceiling.

---

## V1 remnants surfaced by Loop 3 audit

Codebase audit (`AUDIT_PHASE49`) surfaced the following pre-Phase-36 patterns
still in production code. None are blockers. All can land as quick-wins in
Phase 49b or get folded into adjacent feature phases:

- **~82 `rounded` (bare 8px)** — concentrated in:
  - `app/admin/*` (admin console — owner-facing, lower polish priority)
  - `app/[locale]/(app)/appointment-form-modal.tsx` (high-visibility modal)
  - `app/admin/shops/new/create-shop-form.tsx` (error alerts)
- **1 `focus:ring-1`** — `components/ui/search-bar.tsx:25`. Should be
  `ring-2 ring-accent/30` per Phase 47 standard.
- **~15 `transition-colors` without duration/ease** — row action buttons in
  barbers/clients/products clients + toast close button. Bare transitions
  feel snappy-but-unweighted; the Phase 47 standard adds
  `duration-150 ease-out-quint`.
- **0 bare `shadow`** ✅
- **0 TODO/FIXME/XXX** ✅

---

## Loop 4 — proposed phases

The Phase 46 V1.1 roadmap stays valid; the audit just adds a quick-win pass at
the top.

| Phase | What | Budget | Notes |
|---|---|---|---|
| 49 | Audit doc (this file) + README phase list update | 1h | ✅ self-included |
| 49b | V1 remnants quick-win pass (search-bar focus, row-button transitions, admin rounded-md) | 1-2h | All surfaces touched by Loop 3 audit |
| 50 | Stripe Elements UI in booking flow (PCI-compliant card form) | 6-8h | Was "47" in Phase-46 plan |
| 51 | Loyalty balance redemption on booking (auto-apply discount) | 2-3h | |
| 52 | Waiting list flow (add when full + notify when slot opens) | 4-6h | |
| 53 | Date-range picker + per-category breakdown on /finances | 3-4h | |
| 54 | Commission report (against commission_tiers) | 4-5h | |
| 55 | Service category UI polish (drag-reorder, color coding) | 2-3h | |
| 56 | Email templates per-shop customization (logo, colors) | 3-4h | |
| 57 | Reviews / ratings collection after appointment | 4-6h | |
| 58 | Marketing/announcement banner (push to /book page) | 3-4h | |
| 59 | Multi-shop switcher for users with access to multiple shops | 3-4h | |

---

## V1.5+ candidates (further out)

- Image upload (avatars + logos) via Supabase Storage
- 2FA for owners
- Self-service `/me` page for clients (loyalty + Loi 25 self-export)
- Cookie consent banner (if EU traffic possible)
- Lighthouse CI + perf budget
- Visual regression tests (Playwright snapshot of /book + /calendar)
- Pricing page + tier system (multi-tenant SaaS billing)
- Audit log retention policy (currently unbounded)

---

*Generated end of Loop 3 (commits 46→48). Update at each subsequent loop.*
