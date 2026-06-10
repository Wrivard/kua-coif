# Plan 028: SPIKE — POS-lite step 1: walk-in appointments + charge-at-counter (card via existing action, cash recorded)

> **Executor instructions**: DESIGN SPIKE — deliverable is
> `plans/028-OUTPUT-pos-lite-step1-design.md` + answered/open questions; no
> production code. Honor STOP conditions; update the status row when done.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- "app/[locale]/(app)/schema.ts" "app/[locale]/(app)/actions.ts" "app/[locale]/(app)/appointment-detail-drawer.tsx" "app/[locale]/(app)/finances"`

## Status

- **Priority**: P3 (product leverage: HIGHEST of the three spikes — the
  biggest functional gap vs Squire; most barbershop transactions happen at
  the counter, many in cash)
- **Effort**: spike M; the build it specifies: L (step 1 only — the staged
  POS vision is XL and explicitly NOT this)
- **Risk**: LOW (spike). The build: MED-HIGH — it's the money path;
  finances/commissions must distinguish reserved vs collected
- **Depends on**: none (027 recommended first only for role clarity)
- **Category**: direction
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

The spec opens with "L'app remplace un POS" — and today a counter
transaction is unrecordable: the admin appointment form REQUIRES a client
(`appointmentSchema` → `client_id: z.string().uuid()`, no null) even though
the ENTIRE downstream stack was made walk-in-safe (nullable
`appointments.client_id`, `client_name_snapshot`, a QuickBooks "Walk-in"
customer path, null-guarded receipts); `chargeAppointment` — a complete,
hardened server action (rate-limited, idempotent, orphan-PI recovery,
walk-in-aware) — has **zero UI callers**; and a CASH payment cannot be
recorded at all (`payment_status` only moves via Stripe), so
finances/commissions/QuickBooks run on RESERVED totals, not collected money.
Step 1 = walk-in + counter card + recorded cash. Inventory/product sales/POs
are explicitly steps 2–3, NOT designed here.

## Current state (read first; verified at `ef34cee`)

- `app/[locale]/(app)/schema.ts:4-20` — `appointmentSchema.client_id` is a
  required uuid; the walk-in the schema downstream supports cannot be
  created from the UI.
- `app/[locale]/(app)/actions.ts:1281+` — `chargeAppointment` (manager+,
  20/hr rate bucket, Connect-status gate, `already_paid` idempotency,
  walk-in null-guarded email lookup; returns `{clientSecret,
  paymentIntentId}` for Stripe Elements confirm). Comment notes "Stripe
  Elements UI … V1.1 work". An orphan-PI recovery audit row exists at
  :1422 (durable post-plan-007).
- `components/ui/fab-buttons.tsx` — the decorative POS button was REMOVED
  "until there is a real V1 POS flow".
- Payment fields on appointments: `payment_status`
  (unpaid/pending/paid/refunded/failed), `payment_intent_id`,
  `deposit_amount_cents`, `tip_amount_cents`, `total_amount` (dollars).
  NOTHING records the payment METHOD (cash vs card) — finances/today
  approximates "unpaid = cash drawer" (`finances/today/page.tsx:130-146`
  counts `unpaid` completed rows as drawer cash — i.e. cash sales currently
  stay 'unpaid' forever and the drawer math RELIES on that accident).
- Stripe Elements already runs in the repo: the public booking wizard's
  payment section (mount-from-clientSecret pattern to copy).
- `@stripe/react-stripe-js` + `@stripe/stripe-js` are dependencies.

## Steps (spike deliverables)

### Step 1: Design the cash model (THE decision)

Today "cash" is representable only as eternal `unpaid` — and finances/today's
drawer EXPECTS that. Options:
- **A. `payment_method` column** (`'card_online' | 'card_counter' | 'cash' |
  null`) + cash sets `payment_status='paid'`: honest data; REQUIRES reworking
  finances/today's drawer math (paid+cash joins the drawer; paid+card
  doesn't) and the /finances breakdowns. Recommended hypothesis — analyze
  the full blast radius (grep every `payment_status` consumer: finances ×2,
  receipt, reconcile cron, webhook, exports, QuickBooks sync — does QB
  SalesReceipt care about method?).
- **B. Status quo plus** ("cash = completed+unpaid" formalized): zero
  migration, but 'unpaid' forever is a lie that blocks any future
  receivables/no-show-fee feature. Document why rejected (or not).
- Decide where TIP fits for counter payments (cash tip on a card charge?
  `tip_amount_cents` semantics at the counter).

### Step 2: Specify walk-in creation

Schema delta (`client_id` nullable + `walk_in: boolean` UI toggle + optional
free-text name → `client_name_snapshot`), the form modal changes, what
downstream consumers need re-checking (the spike lists them: loyalty award
skips null clients? review-request? reminders cron with null client —
verify each via grep and state the behavior). Server action delta in
`createAppointment` (the insert already handles the columns — confirm).

### Step 3: Specify the "Encaisser" (charge) drawer flow

- Card: drawer button (manager+ — and the 027 question: barbers?) → calls
  `chargeAppointment` → Stripe Elements modal (copy the wizard's
  payment-section mount) → confirm → optimistic `payment_status` refresh.
  Enumerate the states (already_paid, not_connected, declined, processing).
- Cash: one action `markPaidCash` (new; manager+; sets method+status per the
  step-1 model; durable audit; idempotent; NO Stripe) + drawer button with
  ConfirmDialog. Refund-of-cash = out of scope step 1 (note it).
- Amount: the appointment's `total_amount` (+tip?) — decide whether the
  counter flow allows editing the amount (recommend: no in step 1; price
  edits happen on the appointment's services).

### Step 4: Finances impact memo

For the chosen cash model: exactly which queries/labels in
`/finances` and `/finances/today` change meaning, the migration/backfill
story for historical rows (`payment_method = null` = legacy), and what the
commission engine should consume (collected vs reserved — recommendation:
UNCHANGED in step 1, commissions stay on completed totals; flag the
divergence explicitly).

### Step 5: Write the design doc

`plans/028-OUTPUT-pos-lite-step1-design.md`: decisions + blast-radius tables
from steps 1–4, schema migration sketch, the two action signatures, UI
deltas (form toggle, drawer section, finances labels), test plan sketch
(harness: markPaidCash idempotency + chargeAppointment happy/declined;
e2e: walk-in create → cash close), staged-build order (walk-in first — it's
independent and S; then cash; then card UI), effort per stage, and the open
operator questions (cash model A confirmation; who may charge — manager-only
vs barber-own; tip-at-counter policy).

## Done criteria

- [ ] Design doc with the cash-model decision + full payment_status consumer
      blast-radius table (grep-derived, file:line)
- [ ] Walk-in downstream checklist (loyalty/reminders/review/QB) answered
      from code
- [ ] Staged build order with per-stage effort
- [ ] No app-code changes (`git status`: only plans/)
- [ ] `plans/README.md` status row updated

## STOP conditions

- You find an existing `payment_method`-like column or a cash pathway
  (premise stale) — report.
- The drawer-math dependency on "unpaid = cash" turns out to be load-bearing
  in MORE places than finances/today — list them all before recommending
  model A.

## Maintenance notes

- Steps 2–3 of the POS vision (product line-items + inventory decrement;
  stock-taking/PO) stay parked until step 1 ships and a real shop asks —
  the audit's DIR-03 staging rationale stands.
- The reconcile cron + webhook only ever touch PI-bearing rows — cash rows
  must stay invisible to them (assert in the design).
