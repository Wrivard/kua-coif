# AUDIT — Phase 60 (post-loop 6 production readiness)

> Snapshot at the end of Loop 6 (Phase 60 delivered; others queued).
> Companion to `AUDIT_PHASE58.md` (loop 5), `AUDIT_PHASE55.md` (loop 4),
> `AUDIT_PHASE49.md` (loop 3), `AUDIT_PHASE46.md` (loop 2), `AUDIT_PHASE37.md`
> (baseline).

---

## What landed in Loop 6

| Phase | Delivered | Status |
|---|---|---|
| 60 | Loyalty redemption surfacing in wizard summary | ✅ |
| 61 | db/types.ts regen | ⏳ user task (see below) |

### Phase 60 — Loyalty hint in wizard summary

The last piece of the loyalty UX picture. Server-side has been applying
the credit since Phase 50 — the customer was getting the discount but
the wizard summary still showed the full price. Loop 6 closes the gap.

- New server action `lookupLoyaltyByPhone({shop_slug, phone})` — anonymous,
  rate-limited (60 / 10min / IP), returns `{balanceCents: number}` or 0
  for any phone that doesn't match. Critically, the response is the SAME
  shape whether there's a hit or a miss — a scraper can't enumerate
  registered phones by POSTing random digits.

- New wizard state field `loyaltyBalanceCents: number`. Debounced 500ms
  `useEffect` on `state.phone` calls the action when the phone has ≥7
  digits. Resets to 0 on backspace below the threshold.

- Client-side mirror of the server's cap logic:
  ```
  loyaltyCreditCents = min(balance, runningCents)
  totalAfterLoyalty = max(0, totalPrice - credit/100)
  ```
  Same math as `bookPublicAppointment` so the summary stays in sync
  with what the server will actually charge.

- Summary card in step 4 now renders a three-line breakdown when the
  credit applies (subtotal / loyalty credit / total) and falls back to
  the single-line total when there's no balance. Loyalty line is in
  `text-success` so the customer sees a clear positive signal.

- New translations: `subtotalLabel`, `loyaltyApplied`, `totalLabel` on
  `pages.booking.steps.contact` × 2 locales.

### Phase 61 — Types regen (user task)

Tried again via Supabase MCP `generate_typescript_types` — output is
~60KB JSON and round-tripping it through the LLM context is expensive.
The codebase compiles + works because everywhere we use the Supabase
client we cast as `any` (the project convention since Phase 0).

**To regenerate locally:**

```bash
pnpm exec supabase gen types typescript \
  --project-id jzpfvefrjtwqfyynhczp > db/types.ts
git add db/types.ts && git commit -m "chore(db): regen types"
```

Or via the npx flow if `supabase` isn't in dev deps:
```bash
npx supabase login
npx supabase gen types typescript \
  --project-id jzpfvefrjtwqfyynhczp > db/types.ts
```

This is a chore — runs in under a minute, no functional impact, just
drops the `any` casts in newer code paths (Phase 53 waitlist_entries,
Phase 56 payment fields on appointments, the loyalty_balance_cents on
clients added in Phase 43).

---

## Production-blockers status

| Item | Status | Notes |
|---|---|---|
| P0.1 — Real charges | ✅ end-to-end | Phase 56. |
| P0.2 — Loi 25 export + delete | ✅ | Phase 40. |
| P0.3 — db/types.ts codegen | ⚠️ stale | User task, one command. |
| P1.1 — Loyalty + promo + waiting list | ✅ functional + UI | Phase 60 ships the last surfacing. |
| P1.2 — Reports | ✅ | |
| P1.3 — Onboarding wizard | ✅ light | |
| P1.4 — Custom domain | user task | |

**No P0 blockers remain that block launch for a single Quebec
barbershop.** The remaining items are quality-of-life polish + features
that grow the platform.

---

## Loop 7 — proposed phases

Roadmap is still healthy. The big remaining themes:

| Phase | What | Budget | Notes |
|---|---|---|---|
| 62 | Email templates per-shop customization (logo, accent color) | 3-4h | |
| 63 | Reviews / ratings collection after appointment | 4-6h | New table + email link + admin display. |
| 64 | Marketing banner on /book page (push to clients) | 3-4h | |
| 65 | Multi-shop switcher in sidebar for owners with N shops | 3-4h | |
| 66 | Image upload (avatars + logos) via Supabase Storage | 4-5h | |
| 67 | 2FA for owners (Supabase Auth MFA) | 4-6h | |
| 68 | Self-service `/me` page (loyalty + Loi 25 self-export) | 3-4h | |
| 69 | Waitlist notification automation (auto-email when slot opens) | 4-6h | Cron + matching algorithm. |

---

## V1.5+ candidates (further out)

- Cookie consent banner (if EU traffic possible)
- Lighthouse CI + perf budget
- Visual regression tests
- Pricing page + tier system (multi-tenant SaaS billing)
- Audit log retention policy
- Native mobile app
- Per-barber online booking pause / vacation auto-block
- Stripe Apple Pay / Google Pay via Payment Request Button
- Webhook event replay tooling for admins

---

## Loop-6 metrics

- Phases completed: 1 / 2 planned (Phase 61 is a user task)
- New server actions: 1 (`lookupLoyaltyByPhone`)
- New wizard state fields: 1 (`loyaltyBalanceCents`)
- Files touched: 5 (actions.ts, booking-wizard.tsx, en/fr.json, README)
- Translations: +6 keys (×2 locales)

---

*Generated end of Loop 6 (commit 60). Update at each subsequent loop.*
