# AUDIT — Phase 65 (post-loop 8 production readiness)

> Snapshot at the end of Loop 8. Phases 62, 63, 65 shipped to varying
> depths. Phases 66, 67, 68, 69 explicitly deferred — they each need a
> dedicated loop to do justice. Companion to `AUDIT_PHASE64.md` (loop 7).

---

## What landed in Loop 8

| Phase | Delivered | Status |
|---|---|---|
| 65 | Multi-shop switcher (cookie + selector page) | ✅ MVP |
| 62 | Email per-shop branding (columns + admin UI) | ⚠️ data layer only |
| 63 | Reviews table + RLS | ⚠️ schema only |
| 66 | Image upload | ⏳ deferred (Storage bucket setup is interactive) |
| 67 | 2FA | ⏳ deferred (full MFA enrollment + challenge flow) |
| 68 | /me page | ⏳ deferred (needs phone-OTP infra) |
| 69 | Waitlist auto-notify | ⏳ deferred (cron + matcher algorithm) |

### Phase 65 — Multi-shop switcher (MVP)

The first iteration of multi-tenancy UX. Users with memberships in >1
shop can now switch the active context without signing out.

- New constant `SHOP_COOKIE = 'kua_active_shop'` in `lib/auth/server.ts`.
- `getCurrentShopId()` rewritten to read the cookie, validate it against
  the user's confirmed memberships, fall back to the first membership
  if the cookie names a shop they no longer belong to. Backwards
  compatible — single-membership users see no behavior change.
- New server action `selectShop({shop_id})` in
  `app/[locale]/(app)/actions-shop-switcher.ts`. Verifies membership
  BEFORE setting the cookie (defense in depth), 1-year max-age,
  httpOnly + sameSite=lax + secure-in-prod. `revalidatePath('/', 'layout')`
  on success so the sidebar + page header re-render with the new shop.
- New page `/settings/active-shop` with a card-style picker showing
  each shop name + role + a "Current" pill on the active one. "Switch"
  button calls the action.
- Single-membership users see a "You only have one shop" message.

What's left for V1.1 (Phase 65b):
- Sidebar dropdown next to the brand mark (so switching takes one click
  from anywhere in the app, not two).
- Toast confirmation after switch ("Now managing Axum Barbershop").
- Last-active-shop preference persisted server-side, not just cookie
  (so the user has the same context when logging in from a different
  browser).

### Phase 62 — Email branding (data layer)

The data layer for per-shop transactional email branding is shipped;
the email pipeline integration is V1.1.

- Migration `20260525240000_shops_email_branding.sql`:
  - `shops.email_logo_url text` — nullable
  - `shops.email_accent_color text` — nullable, CHECK
    `~ '^#[0-9a-fA-F]{6}$'`
- `shopDetailsSchema` extended with both fields. Email logo as URL
  string; accent color validated as `#rrggbb`.
- Admin UI: new "Email branding" section card on `/settings/shop` with
  URL input + hex color input. Invalid hex flagged via the existing
  `invalid` boolean on `<Input>`.
- Translations × 2 locales.

What's left for V1.1 (Phase 62b):
- Update `lib/email/send.ts` + the React Email templates to substitute
  the shop's `email_logo_url` for the platform logo and
  `email_accent_color` for the CTA color when set. Currently the
  columns are read by nothing — the templates always use platform
  defaults. Owners can save the values; they just have no effect yet.

### Phase 63 — Reviews schema

The `reviews` table is now in the database with proper RLS. Submission
flow + admin moderation UI ship in subsequent loops.

- Migration `20260525250000_reviews.sql`:
  - id (uuid), shop_id, appointment_id (nullable), client_id (nullable),
    barber_id (nullable), rating (1-5 CHECK), comment, status
    (`pending` | `published` | `rejected`), client_name, timestamps.
  - Index on (shop_id, status, created_at desc) — covers the admin
    moderation queue read pattern.
  - Partial index on (barber_id, status) WHERE status = 'published' —
    fast aggregation for per-barber rating averages.
- RLS:
  - Shop members (confirmed) — read / update / delete entries for their
    shop.
  - Anonymous (`anon` role) — SELECT only `published` reviews. Future
    `/book/[shopSlug]` can render social proof without auth.

What's left:
- Public submission flow via signed token in the confirmation email
  (`Phase 63b` — V1.1).
- Admin moderation UI at `/settings/reviews` (`Phase 63c` — V1.1).
- Per-barber rating roll-up on `/book/[shopSlug]/barbers` picker
  (`Phase 63d` — V1.2).

### Phase 66 — Image upload (deferred)

Reason for deferral: Supabase Storage bucket creation isn't directly
exposed via the MCP — it requires either the dashboard UI or the
Storage API with a service-role key. Doing it half-way (writing the
server action against an assumed bucket that doesn't exist) would
ship code that 500s the first time it's exercised.

Recommended approach for Phase 66:
1. Create bucket `shop-assets` (public read, authenticated write) via
   Supabase dashboard.
2. Server action `uploadShopAsset({kind: 'logo'|'avatar', base64, mime})`
   uses `createSupabaseServiceRoleClient().storage.from('shop-assets').upload(...)`.
3. Returns public URL; caller persists it to the appropriate column.
4. Admin UI: drag-drop area on `/settings/shop` (logo) and per-barber
   on `/barbers` (avatar).

### Phase 67 — 2FA (deferred)

Supabase Auth has built-in MFA primitives
(`supabase.auth.mfa.enroll/challenge/verify/unenroll`). The work isn't
complex but it's high blast-radius (touches the auth flow), so it gets
its own loop.

Recommended:
1. New page `/settings/two-factor`.
2. Enrollment UI: call `enroll({factorType: 'totp'})`, render the QR
   from the returned secret, accept the user's 6-digit code, call
   `verify()`.
3. List + unenroll existing factors.
4. Middleware enforces challenge on next sign-in for enrolled users.

### Phase 68 — /me page (deferred)

Requires phone-OTP infrastructure that isn't currently configured
(needs SMS provider in Supabase Auth). Alternative: signed token in the
confirmation email. Either path is a 3-4h lift on its own.

### Phase 69 — Waitlist auto-notify (deferred)

Needs:
1. A matching algorithm: when a slot opens, find the earliest
   waitlist entry whose `(date_window_start..date_window_end,
   preferred_barber_id, service_ids)` fits.
2. A trigger: either a cron job that scans hourly (cheap, simple) or
   a Postgres trigger on `appointments` UPDATE/DELETE (zero-latency,
   complex).
3. The actual notification — email via Resend with a one-click booking
   link, status moves to `notified`.

Each piece deserves dedicated thought; bumping to a focused loop.

---

## Production-blockers status

| Item | Status |
|---|---|
| P0.1 — Real charges | ✅ end-to-end (Phase 56) |
| P0.2 — Loi 25 export + delete | ✅ (Phase 40) |
| P0.3 — db/types.ts codegen | ⚠️ stale (user task) |
| P1.1 — Loyalty + promo + waiting list | ✅ functional + UI |
| P1.2 — Reports | ✅ |
| P1.3 — Onboarding | ✅ light |
| P1.4 — Custom domain | user task |

No P0 blockers. Loop 8 adds owner-side flexibility (multi-shop switcher,
email branding fields) and the reviews data foundation.

---

## Loop 9 — proposed phases

| Phase | What | Budget |
|---|---|---|
| 62b | Wire email_logo_url + email_accent_color into the email templates | 2-3h |
| 63b | Public reviews submission via signed-token email link | 3-4h |
| 63c | Admin moderation UI for reviews | 2h |
| 65b | Sidebar dropdown for multi-shop switcher | 1-2h |
| 66 | Image upload (bucket + action + UI) | 4-5h |
| 67 | 2FA enrollment + challenge | 4-6h |
| 68 | /me page (with chosen auth approach) | 3-4h |
| 69 | Waitlist auto-notify (cron + matcher) | 4-6h |

---

## Loop-8 metrics

- Phases completed: 3 / 7 attempted (3 MVPs + 4 explicitly deferred
  with clear rationale)
- New migrations: 3 (`shops_marketing_banner` was loop 7; loop 8 adds
  `shops_email_branding`, `reviews`, and the multi-shop work needed
  no migration — just app code)
- New server actions: 1 (`selectShop`)
- New pages: 1 (`/settings/active-shop`)

---

*Generated end of Loop 8 (commits 65, 62 data layer, 63 schema). Update at
each subsequent loop.*
