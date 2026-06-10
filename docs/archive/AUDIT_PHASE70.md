> ARCHIVED 2026-06-10 — superseded snapshot; not current state. See docs/archive/README.md.

# AUDIT — Phase 70 (Ultrathink Deep-Dive)

> Cross-cutting audit covering integrations, frontend design (vs Vercel
> reference), real-world business gaps. Synthesizes findings from three
> parallel investigation agents. Companion to every previous audit doc;
> supersedes their roadmap projections for what to build next.

## Executive summary

**The architecture is sound. The frontend looks "premium" but is
philosophically off from the Vercel reference. The integrations are
mostly wireframes — Stripe + Google Calendar are 80-90% real, but
QuickBooks is OAuth-only, SMS is absent, and Sentry isn't actually
turned on.**

For a real Quebec barbershop adopting this tomorrow, the first **5
launch-blockers** are operational (no print receipt, no self-service
rescheduling, walk-in flow broken because `client_id NOT NULL`, no
cash/tip reconciliation, currency hardcoded to CAD). The next **9
day-one frictions** are owner-experience (bulk cancel, daily close-out,
recurring block time, loyalty expiry, refund UX, owner notifications,
public availability API for embedding, etc.).

The Vercel pivot is **feasible at minimum scope (10h)** — flip palette,
swap CSS borders for shadow-as-border, drop weight-700 — but the full
Vercel system fidelity (4-layer card shadows, workflow-only accent
usage, letter-spacing curve) is a **40-50 file, ~3-week change**.

Roadmap below splits everything into prioritized loops 13-20+.

---

## A) Integrations deep-dive

### 1. Stripe (Connect + PaymentIntent + Elements + Webhook) — 80%

**Wired**: full Connect Express onboarding, PaymentIntent backend with
idempotency keys, refund flow with `reverse_transfer +
refund_application_fee`, webhook signature verification, payment_status
reconciliation via `payment_intent.*` + `charge.refunded` events,
Elements UI in booking step 4.

**Critical gaps**:
1. **No `application_fee_amount` collection** — `lib/stripe/payments.ts:65`
   defaults to 0. Küa earns $0 from card transactions today even though
   the plumbing exists.
2. **Race condition on cancel + refund** — `cancelAppointment` fires
   refund while webhook is still updating `payment_status` from
   `processing` to `paid`. No transactional lock.
3. **Refund idempotency key includes amount** — caller passing
   `undefined` vs explicit amount produces different keys; retry could
   double-refund.
4. **No shop-active gate before rendering Elements** — booking wizard
   doesn't verify `stripe_connect_status='active'` before rendering
   PaymentElement. KYC-incomplete shops silently fail card confirm.
5. **No 3DS / decline-code handling** — Elements `confirmPayment()`
   returns decline reasons, but the wizard only shows generic
   "PAYMENT_FAILED". Customer doesn't know to use their bank's app.
6. **`STRIPE_WEBHOOK_SECRET` not in `.env.example`** documented but
   easy to miss; webhook route fails 500 without it.

**Quick wins (~2h)**:
- Gate Elements render on `stripe_connect_status='active'`.
- Surface decline reasons from Stripe.js error object.
- Add `application_fee_amount` env var (`STRIPE_APP_FEE_BPS`) and pipe
  through `createDepositPaymentIntent`.
- Fix refund idempotency: always pass explicit `amountCents` (use the
  appointment's `deposit_amount_cents` as the default).

### 2. QuickBooks — 30%

**Wired**: OAuth flow only. Code exchange, token refresh helper,
revoke. Encrypted refresh-token storage on `shops.quickbooks_refresh_token_enc`.
Settings UI to connect.

**Missing**:
1. **No invoice / sales-receipt creation** — connecting QB does
   absolutely nothing today. The bookmark of "QuickBooks integrated"
   on the README is technically true (OAuth works) but functionally
   the owner sees no QB invoices after appointments.
2. **No token refresh job** — QB tokens expire after 100 days of
   inactivity. No cron, no on-demand refresh. Within 4 months of
   light use, every shop's connection dies silently.
3. **No error recovery** — refresh failures don't update
   `quickbooks_connect_status`.
4. **realm_id never validated** at OAuth callback; possible to spoof.
5. **No settings UI status panel** — owner can't see "connected as
   ACME Inc." vs "needs reconnect."

**Quick wins (~4h)**:
- Cron `/api/cron/quickbooks-refresh` weekly, refresh active tokens.
- Try/catch on refresh → set `status='expired'` on 401/410.
- Add status panel + "Reconnect" button to `/settings/quickbooks` (or
  a new page if one doesn't exist).

**Real work to make QB useful (~8-12h)**: implement invoice creation
on appointment completion. Mapping: appointment.total_amount →
QuickBooks SalesReceipt; client → QB Customer (find-or-create);
services → line items.

### 3. Google Calendar — 90%

**Wired**: OAuth + encrypted refresh-token storage. Push (appointment
create/update/delete → barber's GCal as event). Pull (busy periods
displayed on Küa calendar with 60s cache). `google_event_id` column
for idempotent updates.

**Gaps for true two-way sync**:
1. **No external-edit detection** — if the barber edits the event in
   GCal directly (title, time, delete), Küa never knows. We're "push
   + read-only display of personal busy" not bidirectional.
2. **No rate-limit backoff** — Google's 1000 req/min cap. Mass-edit
   would 429 + leave `last_error='rate_limited'`.
3. **No disconnect UI** — only Küa admin can clear the row.
4. **`google_event_id` orphaning** — if sync fails, the stale ID never
   gets cleared; next reschedule tries to update a deleted event.
5. **`last_synced_at` updated on pull too** — confusing UX metric.

**Quick wins (~3h)**:
- "Disconnect Google Calendar" button on `/settings/users`.
- Exponential backoff (1s/2s/4s) on Google API calls, max 3 retries.
- Clear `google_event_id` on `sync_status='error'` transitions.
- Restrict `last_synced_at` update to actual push events.

**True two-way (~8-12h)**: webhook subscription via Google's push
notifications API (calendar.events.watch). Requires HTTPS endpoint
with verified domain + cron-rotated channel renewals every 7 days.

### 4. Sentry / Observability — 20%

**Wired in code**: `instrumentation.ts`, `sentry.server.config.ts`,
`sentry.client.config.ts`. `lib/observability.ts` exposes
`captureException()` / `captureMessage()` / `setUser()`. Breadcrumbs
at a few critical points (Stripe webhook, Google sync, email send).

**Critical gaps**:
1. **`SENTRY_DSN` not set anywhere** — no production errors are
   actually shipped. Phase 3 wired the SDK but no one turned it on.
2. **Server Actions not wrapped** — `bookPublicAppointment`,
   `cancelAppointment`, etc. have try/catch but don't always call
   `captureException()` on the catch path.
3. **`tracesSampleRate: 1.0`** in production — will blow through the
   free tier (5k events/month) in days.
4. **No source maps** uploaded to Sentry — minified stack traces.
5. **No user context** — errors look anonymous in the Sentry UI.
6. **No error categories / alerting rules**.

**Quick wins (~2h)**:
- Set `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` in Vercel env.
- Drop sample rate to 0.1 in prod.
- Call `setUser({id, email})` in the (app) layout after auth resolves.
- Source map upload via `@sentry/nextjs` plugin in `next.config.js`.
- Add `captureException` to every server-action catch block (script-
  level audit + add).

### 5. SMS / phone notifications — 0%

Absent. `notification_automations` table likely has the schema room
for SMS but no client, no trigger, no UI. To ship:
- Pick provider (Twilio is standard; MessageBird cheaper for Quebec).
- `lib/sms/client.ts` wrapping the SDK with idempotency keys.
- Extend `notification_sends` with `sms_status` + `phone_number`.
- Cron hook in `/api/cron/notifications` to dispatch SMS reminders.
- Per-phone rate limit (e.g., 3 reminders/week/client max).
- Status webhook (`/api/webhooks/twilio/sms-status`) → update
  `notification_sends`.

**Estimate**: 8h baseline + provider account setup.

### 6. MCP — safe

Supabase MCP is dev-tooling only. No production code exposes MCP
endpoints. Service-role key correctly never exported to client. No
remediation needed.

---

## B) Frontend audit vs `vercel_design.md`

### Foundational deltas

| Dimension | Current (Phase 36) | Vercel | Verdict |
|---|---|---|---|
| Theme | Dark `#0b0b0d` bg | Light `#ffffff` bg | **Direction flip required** |
| Font | Geist ✓ | Geist + aggressive negative letter-spacing | ✓ Font / ✗ tracking curve |
| Borders | CSS `border-border` | `box-shadow 0 0 0 1px rgba(0,0,0,0.08)` | **Wrong technique throughout** |
| Shadow stacks | Drop + inset highlight (2 layers) | 4-layer (border + elevation + ambient + inner #fafafa glow) | Simplified |
| Color use | Purple decoratively (chips, KPIs, etc.) | Monochrome + workflow colors functionally only | **Violates Vercel rule** |
| Weights | 400 / 500 / 600 / **700** (sidebar logo) | 400 / 500 / 600 only | **`font-bold` to remove** |
| Focus ring | `ring-accent/30` (soft purple) | `hsla(212, 100%, 48%, 1)` saturated blue | Wrong color |
| Radius scale | 6/8/12/16 | 2/4/6/8/12/64/100/9999 | Missing micro + pill |

### Component-by-component (top 10)

| Component | Current | Vercel target |
|---|---|---|
| Sidebar | `bg-bg-surface` + `border-r border-border`, K logo `font-bold` | Light bg, shadow-border, weight-600 logo |
| PageHeader | `bg-bg-base/80 backdrop-blur-xl` + `border-b border-border` | Same blur, shadow-border bottom |
| Card | `rounded-lg border border-border bg-bg-surface shadow-sm` | No CSS border; 4-layer shadow stack |
| Button | Primary accent + glow ✓ ; secondary `border border-border` | Secondary needs shadow-border |
| Input/Select/Textarea | `border border-border` + soft accent ring | Shadow-border + saturated blue focus ring |
| Badge | 6 variants (accent/success/warning/danger/info/default) | Single pill `#ebf5ff` bg + `#0068d6` text; workflow colors only |
| Modal/Drawer | `<dialog>` + scale animation ✓ | Shadow stacks + Vercel backdrop hsla(0,0%,98%,1) |
| Data Table | `border border-border` rows | Shadow-bordered container + subtle row separators |
| Calendar grid | Phase 48 border-border-soft / -faint tokens | Re-palette completely for light theme |
| EmptyState | Phase 47c halo + dashed border | Shadow-bordered, no dashed |

### Accessibility

- **Focus ring color is the highest a11y debt** — accent purple on dark
  is OK but lower visibility than Vercel's saturated blue on white.
  Switch on the light pivot.
- Color contrast currently 17:1 (dark theme); Vercel light is 13:1.
  Both pass WCAG AAA.
- Keyboard nav appears compliant where reviewed.

### Motion

`ease-out-quint` used consistently. Skeleton shimmer, modal scale, hover
lift — all premium and not overused. **No changes needed**.

### Real-world UX small frictions

- DataTable has no virtualization (clients table could grow to 5k+).
- Long-form save → does the page restore scroll on validation error?
  Not tested.
- Loading skeletons exist on tables but maybe missing on individual
  cards / filters.

### Pivot scope

**Minimum (10h)** — flip palette + replace `border border-border` with
shadow-as-border utility + remove `font-bold` + change focus ring color.
80% Vercel alignment.

**Maximum (3-5 weeks)** — multi-layer card shadows, workflow accent
color discipline, letter-spacing curve at display sizes, full radius
scale, comprehensive component re-audit. 100% Vercel alignment.

---

## C) Real-world business gaps

### P0 — launch blockers (5)

1. **No print receipt / PDF** — customer pays, gets nothing tangible.
   Email-only is fragile (no email captured? no fallback).
2. **No self-service client rescheduling** — every "move my 2pm to
   3pm" is a phone call to the shop.
3. **Walk-in flow broken** — `appointments.client_id NOT NULL` means
   barbers must create a phantom client every walk-in.
4. **No cash/tip reconciliation** — `tips_config` exists but no
   `appointments.tip_amount_cents`. Owner can't audit shift-end tips.
5. **Multi-currency hardcoded** — `formatCurrencyCAD()` is the only
   formatter. Quebec-only product (acceptable for MVP if explicit).

### P1 — day-one frictions (9)

6. **No offline / service-worker** — barber's phone hiccups, calendar
   blanks.
7. **No daily close-out report** — owner manually opens `/finances`,
   sets date, scans.
8. **No bulk cancel** — power outage = 8 individual clicks.
9. **No recurring block-time** — "Tuesdays off Q4" = 13 manual rows.
10. **No loyalty expiry** — unbounded liability + customer confusion.
11. **No bulk CSV client export** — only single-client Loi 25 JSON.
12. **No "Refund + Cancel" combo on appointment drawer** — admin
    cancels in Küa, forgets to refund in Stripe dashboard, chargeback.
13. **No owner push notifications** — 2am bookings invisible until
    morning.
14. **No public availability API** — third-party embed (Squarespace,
    Wix) requires REST endpoint, not the iframe-only widget.

### P2 — quality / compliance / perf (16)

15. Phase 66 image upload still deferred (no Storage bucket).
16. **Race condition on slot booking** — no `UNIQUE (barber_id, start_at)`
    constraint; rare but real on busy shops.
17. Soft delete inconsistency — products hard-deleted, members
    soft-deleted, no transition logged.
18. Audit log gaps — `rescheduleAppointment` + `blockTime` not logged.
19. **Server-side re-validation of price** — booking action trusts
    client-sent `service_ids` to look up prices but doesn't re-verify
    `total_amount` math against authoritative DB values for promo +
    loyalty before insert (could be exploited).
20. No documented backup / restore runbook.
21. **Loi 25 consent capture missing** at booking — required by Quebec
    law for new data collection.
22. ToS / Privacy pages exist but content untested for compliance.
23. No published WCAG accessibility statement.
24. No cookie banner (EU exposure possible).
25. No bundle analyzer in CI.
26. No query-count regression assertion on calendar page.
27. **No per-shop SaaS billing** — Küa collects $0 from shops today.
28. No trial period flow.
29. No self-service subscription cancel.
30. **Client-name snapshot missing on appointment** — anonymizing a
    client wipes the name from historical appointments → owner can't
    do retro P&L.

---

## D) Multi-phase roadmap (Loops 13-20+)

Prioritized by P0 → P1 → P2 with explicit dependencies. Each phase is
sized for a single focused loop (~2-6h LLM work).

### Loop 13 — P0 launch unblockers (~6-8h)

| Phase | What | Effort |
|---|---|---|
| 70 | PDF receipt generation + booking confirmation download | 3h |
| 71 | Walk-in flow: nullable `client_id` + barber-side "add walk-in" UI on calendar slot click | 2h |
| 72 | `appointments.tip_amount_cents` column + tip capture on Stripe + receipt + finances breakdown | 2h |
| 73 | Public reschedule flow (`/reschedule/[token]` reusing Phase 63b signed-token helper) | 2h |

### Loop 14 — Vercel design pivot, minimum scope (~10h)

| Phase | What | Effort |
|---|---|---|
| 74 | Theme flip dark→light: rewrite `globals.css` palette + add `--theme: light\|dark` toggle for power users | 3h |
| 75 | Shadow-as-border utility (`shadow-border`, `shadow-border-strong`) + global replace of `border border-border` | 2h |
| 76 | Remove `font-bold`; cap at `font-semibold`. Update sidebar logo + any other 700s | 30m |
| 77 | Focus ring color → Vercel saturated blue. Audit every `ring-accent` use | 1h |
| 78 | 4-layer card shadow stack + inner `#fafafa` glow | 1h |
| 79 | Display-size letter-spacing (-2.4px / -1.28px / -0.96px curve) | 1h |
| 80 | Calendar appointment-block re-palette for light theme | 1.5h |

### Loop 15 — Sentry + observability properly turned on (~3h)

| Phase | What | Effort |
|---|---|---|
| 81 | Set Sentry DSN in Vercel env + sample rate 0.1 in prod | 30m |
| 82 | Wrap every server action's catch path with `captureException` | 1h |
| 83 | `setUser({id, email})` in (app) layout | 30m |
| 84 | Source maps upload via @sentry/nextjs build plugin | 30m |
| 85 | Sentry alert rules for new error signatures + critical actions | 30m |

### Loop 16 — P1 owner-experience (~10h)

| Phase | What | Effort |
|---|---|---|
| 86 | Daily close-out report page `/finances/today` + email digest option | 2h |
| 87 | Bulk cancel UI on calendar (select multiple + "Cancel all") | 1.5h |
| 88 | Recurring block-time form (weekly/biweekly/monthly) | 2h |
| 89 | "Refund + Cancel" combo button on appointment detail drawer | 1h |
| 90 | Owner notification settings (Slack webhook + email digest) | 2h |
| 91 | Bulk CSV client export from `/clients` page | 1h |
| 92 | Loyalty expiry policy column + email reminder 30d before expiry | 2h |

### Loop 17 — Stripe + Google Calendar tightening (~5h)

| Phase | What | Effort |
|---|---|---|
| 93 | Gate Elements render on `stripe_connect_status='active'` + decline reason surfacing + 3DS handling | 1.5h |
| 94 | `STRIPE_APP_FEE_BPS` env var + plumb to PaymentIntent | 30m |
| 95 | Fix refund idempotency (explicit amount on every call) + cancel→refund transactional lock | 1h |
| 96 | Google Calendar disconnect button + rate-limit backoff + orphan cleanup | 1.5h |
| 97 | True two-way Google sync via webhook (events.watch) — own loop because of HTTPS + channel renewal complexity | 4h *(own loop)* |

### Loop 18 — QuickBooks + SMS (the absent integrations) (~12h)

| Phase | What | Effort |
|---|---|---|
| 98 | QuickBooks token refresh cron + status panel + realm_id validation | 3h |
| 99 | QuickBooks invoice / SalesReceipt creation on appointment completion (mapping + idempotency) | 5h |
| 100 | SMS pipeline: Twilio client, `notification_sends.sms_*`, cron dispatch, rate-limit per-phone, status webhook | 8h *(own loop)* |

### Loop 19 — P2 data integrity + compliance (~6h)

| Phase | What | Effort |
|---|---|---|
| 101 | `appointments.client_name_snapshot` column + populate on insert + use in finances/receipts | 1h |
| 102 | `UNIQUE (barber_id, start_at)` constraint with partial index excluding cancelled | 30m |
| 103 | Server-side `total_amount` recompute in `bookPublicAppointment` (never trust client) | 1h |
| 104 | Audit log coverage: add to `rescheduleAppointment` + `blockTime` + soft-deletes | 1h |
| 105 | Loi 25 consent checkbox + terms link on booking wizard step 4 | 1h |
| 106 | Backup runbook (DEPLOY.md section) + verify Supabase PITR retention | 1h |

### Loop 20 — SaaS monetization (~10h)

| Phase | What | Effort |
|---|---|---|
| 107 | Küa subscription tiers schema (`shops.plan` + `trial_ends_at`) + Stripe subscription product | 2h |
| 108 | Self-service `/settings/subscription` page (upgrade / downgrade / cancel via Stripe billing portal) | 3h |
| 109 | 14-day trial flow with card-on-file capture | 2h |
| 110 | Feature gates (multi-barber requires Pro, reviews require Pro, etc.) | 3h |

### Loop 21+ — Vercel full-fidelity polish (~3 weeks)

| Phase | What | Effort |
|---|---|---|
| 111 | Workflow color discipline — replace accent purple with workflow Red/Pink/Blue where appropriate | 4h |
| 112 | Full radius scale (2/4/64/100 added) + audit all radius uses | 2h |
| 113 | Pill badge family (vs current 6-variant Badge component) | 2h |
| 114 | Geist Mono for technical labels (timestamps, IDs, tags) | 1h |
| 115 | DataTable virtualization for 1000+ rows | 3h |
| 116 | Bundle analyzer + tree-shake Stripe.js + lazy-load by route | 3h |
| 117 | WCAG accessibility statement + axe-core CI gate | 2h |
| 118 | Cookie consent banner (geo-gated for EU) | 2h |

### Loops 22+ — Remaining deferred

| Phase | What |
|---|---|
| 119 | 65b sidebar dropdown shop switcher |
| 120 | 66 image upload (Supabase Storage bucket + UI) |
| 121 | 67b 2FA middleware sign-in challenge gate |
| 122 | 69 waitlist auto-notify (cron + matcher algorithm) |
| 123 | Service-worker offline support for calendar |
| 124 | Public availability REST API for third-party embeds |
| 125 | Recurring appointment templates (every 4 weeks for trim) |
| 126 | Family / multi-person booking |
| 127 | Wait-time estimation if a barber runs late |

---

## E) What this means for "production launch"

**Today**: launchable but rocky. The first shop will hit P0 friction
within 24h.

**After Loop 13 (P0 unblockers, ~8h)**: launchable with confidence for
a single Quebec barbershop running ~30 appointments/day.

**After Loops 13-15 (~21h)**: launchable for 2-3 shops with proper
observability. Owner sees Sentry alerts, Vercel-grade UI, no walk-in /
receipt / reschedule blockers.

**After Loop 20 (~70h cumulative)**: real SaaS. Multi-tenant billing,
trial flow, integrations actually moving money, design fidelity.

**After Loops 21+**: scale-ready (virtualization, offline, API).

---

## F) Honest verdict

**The architectural fundamentals are excellent.** RLS, auth, schema,
i18n, server actions, audit log, encryption-at-rest, payment backend,
calendar engine, loyalty math, commission math, reviews schema, 2FA
enrollment, signed-token public flows — all solid.

**The integration depth is shallower than the audit docs imply.**
"Stripe ✓" in the README means PaymentIntent + Elements. It does NOT
mean app-fee collection, decline-reason surfacing, or hardened
cancel/refund race handling. "QuickBooks ✓" means OAuth. It does NOT
mean invoices actually sync.

**The Vercel design pivot is significant but tractable.** ~10h gets
80% there; the remaining 20% is multi-week polish.

**The real-world gaps are the highest-impact next bet.** P0 walk-ins,
receipts, rescheduling, tips — every one of these is a phone call to
the shop owner today. Phase 70-73 (Loop 13) is the highest ROI work
on the entire roadmap.

---

*Generated end of ultrathink audit. Update at the next big-picture
loop (probably after Loop 16).*
