# AUDIT — Phase 64 (post-loop 7 production readiness)

> Snapshot at the end of Loop 7. Phase 64 (marketing banner) shipped;
> Phases 62, 63, 65-69 remain on the roadmap. Companion to
> `AUDIT_PHASE60.md` (loop 6), `AUDIT_PHASE58.md`, `AUDIT_PHASE55.md`,
> `AUDIT_PHASE49.md`, `AUDIT_PHASE46.md`, `AUDIT_PHASE37.md`.

---

## What landed in Loop 7

| Phase | Delivered | Status |
|---|---|---|
| 64 | Marketing banner on /book (admin-editable, toggleable) | ✅ |

### Phase 64 — Marketing banner

A small but high-leverage feature: shop owners can now show a short
promotional message at the top of their public booking page without
editing code. Typical uses: "Grand opening 20% off", "Closed Dec 25-26
— book ahead", "New stylist Olivier now taking appointments".

- Migration `20260525230000_shops_marketing_banner.sql`:
  - `shops.marketing_banner_text` — text, nullable
  - `shops.marketing_banner_enabled` — boolean, default false
- Schema (`shopDetailsSchema` in `settings/shop/schema.ts`) extended
  with both fields. Text capped at 280 chars (Twitter-length — keeps
  the banner readable on mobile).
- Admin UI: new "Marketing" section card on `/settings/shop` with a
  Toggle + Textarea. `setValue('marketing_banner_enabled', v, {shouldDirty: true})`
  pattern matches existing toggles.
- Public render: `/book/[shopSlug]/page.tsx` reads the new columns,
  renders an `accent-subtle` rounded card above the booking wizard when
  both `enabled === true` AND `text` is non-empty.
- Translations added on `pages.settings.shop.marketing.*` and section
  label `marketing` × 2 locales.
- BookingShop type extended with the two optional fields so the wizard
  passes typecheck.
- Caching: `revalidatePublicShopSurfaces()` in `updateShopDetails` was
  already revalidating `/book/[alias]` after edits, so banner changes
  show up immediately.

---

## Deferred from Loop 7

Each remaining phase is a self-contained chunk — explicitly bumping to
loop 8+ so the user can pick the next priority:

| Phase | What | Budget | Notes |
|---|---|---|---|
| 62 | Email templates per-shop customization (logo, accent color) | 3-4h | Per-shop logo URL + brand color → propagate into Resend/SMTP templates. |
| 63 | Reviews / ratings collection after appointment | 4-6h | New `reviews` table + post-appointment email link + admin display. Needs RLS thought. |
| 65 | Multi-shop switcher in sidebar | 3-4h | Cookie-based "active shop" + server action `selectShop(id)` + sidebar dropdown. Touches `getCurrentShopId()` so requires care. |
| 66 | Image upload (avatars + logos) via Supabase Storage | 4-5h | Bucket policies + signed-URL flow + drag-and-drop UI. |
| 67 | 2FA for owners (Supabase Auth MFA) | 4-6h | Enrollment UI + challenge flow + recovery codes. Supabase has the primitives. |
| 68 | Self-service `/me` page | 3-4h | Phone-OTP gate + loyalty balance view + Loi 25 self-export. |
| 69 | Waitlist notification automation | 4-6h | Cron + matcher: when a new slot opens, find earliest waitlist entry whose preferences fit, send notification. |

---

## Production-blockers status

| Item | Status | Notes |
|---|---|---|
| P0.1 — Real charges | ✅ end-to-end | Phase 56. |
| P0.2 — Loi 25 export + delete | ✅ | Phase 40. |
| P0.3 — db/types.ts codegen | ⚠️ stale | User task. |
| P1.1 — Loyalty + promo + waiting list | ✅ functional + UI | Phases 41/43/50/53/57/60. |
| P1.2 — Reports | ✅ | Phases 44/51/52. |
| P1.3 — Onboarding wizard | ✅ light | Phase 45. |
| P1.4 — Custom domain | user task | |

**No P0 blockers.** Phase 64 adds an owner-side polish lever — no impact
on launch readiness, just better day-2 UX for the shop owner.

---

## Loop-7 metrics

- Phases completed: 1 / 1 planned for this scope (kept loop tight
  because the remaining roadmap items are each 3-6h chunks that
  deserve their own attention)
- New migrations: 1 (`shops_marketing_banner`)
- New files: 0
- Files touched: 7 (schema.ts, actions.ts unchanged, page.tsx ×2,
  shop-details-client.tsx, booking-wizard.tsx type extension, en/fr
  translations, README, AUDIT_PHASE64.md)

---

*Generated end of Loop 7 (commit 64). Update at each subsequent loop.*
