# 028 — OUTPUT: POS-lite step 1 — walk-in + charge-at-counter (card via existing action, cash recorded)

> Deliverable of the design spike `plans/028-spike-pos-lite-step1.md`.
> **No production code** was written. All file:line refs verified against the
> worktree at `HEAD` (synced to main; the plan's `ef34cee` line numbers were
> re-located by content where they had drifted).
>
> **STOP-conditions checked:** (1) **no** existing `payment_method`-like column
> or cash pathway exists (grep found only Stripe PI `requires_payment_method`
> states) — premise holds. (2) The "unpaid = cash" assumption is load-bearing
> in **exactly one** place (`finances/today`); not wider — model A is safe to
> recommend. Details below.

---

## 0. TL;DR

- **Cash model: A — add a `payment_method` column; cash sets
  `payment_status='paid'` + `payment_method='cash'`.** It is the only honest
  model and the only one that unblocks future receivables / no-show fees; its
  whole cost is **one** rewrite — `finances/today`'s drawer math — which a
  legacy-compat clause absorbs with **no backfill**.
- **Doc path:** `plans/028-OUTPUT-pos-lite-step1-design.md`.
- **Staged build order:** **(1) walk-in** (independent, **S**) → **(2) cash
  `markPaidCash` + drawer rework** (**M**) → **(3) card "Encaisser" Elements
  modal** (**M**). Ship walk-in first; it has value alone and unblocks the rest.

---

## 1. Step 1 — the cash model decision

### The two options

**A. `payment_method` column + cash ⇒ `payment_status='paid'`** *(recommended)*
- New nullable enum `payment_method ∈ {card_online, card_counter, cash}` (null
  = legacy / not-yet-collected). Counter cash → `status='paid', method='cash'`.
- **Honest data**: "paid" finally means *collected*; method says *how*.
- **Cost**: `finances/today`'s drawer math must change (paid+cash joins the
  drawer; paid+card does not). Nothing else — see the blast-radius table.

**B. Status quo formalized ("cash = completed + `unpaid` forever")** *(rejected)*
- Zero migration. But `payment_status='unpaid'` becomes a permanent **lie**:
  a collected cash sale is indistinguishable from money genuinely owed. It
  **blocks** every future feature that needs "owed vs collected" (receivables,
  no-show fees, partial payments, deposits-vs-balance) and keeps the drawer math
  resting on an *accident* (cash happens to be the only thing left at `unpaid`).
- **Rejected**: the build it forecloses is exactly where POS-lite goes next.

### Decision: **A**. Rationale — B saves one query rewrite today and pays for it
forever; A's cost is contained to a single, well-understood function (§4) and a
legacy-compat clause means **no historical backfill**.

### Blast-radius — every `payment_status` consumer (grep-derived, file:line)

| # | Consumer (file:line) | What it does today | Model-A impact |
|---|---|---|---|
| 1 | `app/[locale]/(app)/finances/today/page.tsx:142-153` | `unpaid` completed → **drawer cash**; `paid` → Stripe; drawer = start + unpaidTotal + unpaid cash tips | **THE rework.** Drawer cash = `method='cash'` (paid) **∪** legacy `method IS NULL AND status='unpaid'`. paid+card excluded. (§4) |
| 2 | `app/[locale]/(app)/finances/page.tsx:81` | filters **`.eq('status','completed')`** only — **never reads `payment_status`** | **None.** /finances is reserved/earned revenue; cash vs card is irrelevant there |
| 3 | `app/api/cron/stripe-reconcile/route.ts` | re-derives `payment_status` for rows **stuck at `'pending'`** (PI-bearing) | **None — cash rows are never `'pending'` and have no PI** → invisible (assert §1.1) |
| 4 | `app/api/webhooks/stripe/route.ts:247-321` | updates `payment_status` by **`payment_intent_id` match** | **None — cash rows have no `payment_intent_id`** → never matched (assert §1.1) |
| 5 | `app/[locale]/(app)/actions.ts:1294-1457` `chargeAppointment` | `already_paid` guard on `payment_status==='paid'`; sets `'pending'` | Card path sets `method='card_counter'` on charge; the `already_paid` guard now also (correctly) blocks re-charging a cash-paid row |
| 6 | `app/[locale]/(app)/actions.ts:1106` cancel/refund; `appointment-detail-drawer.tsx:245` `canRefund` | refund gated on `payment_status==='paid' && payment_intent_id` | **None** for cash (no PI ⇒ not refundable via Stripe). Cash refund = **out of scope** step 1 (§3) |
| 7 | `app/[locale]/(app)/super-admin/page.tsx:88` | `.eq('payment_status','paid')` → **platform-fee revenue** estimate (`app_fee_bps × paid totals`) | **⚠ MUST FIX**: platform earns app-fees only on **Stripe** charges. Add `.not('payment_intent_id','is',null)` (or `method != 'cash'`) so cash doesn't inflate platform revenue |
| 8 | `app/[locale]/(app)/appointments-calendar.tsx:394` | `paidCount` badge tally | Cosmetic — cash now counts as paid (desirable: the chip shows collected) |
| 9 | `app/[locale]/receipt/[token]/receipt-client.tsx:323` | shows `statusLabel[payment_status]` | Cash receipt shows "paid" (correct). Nice-to-have: a "Payé (comptant)" label variant |
| 10 | `app/[locale]/(app)/clients/actions.ts:255` | passes `payment_status` through to client history UI | **None** (display passthrough) |
| 11 | `lib/quickbooks/sync.ts` (SalesReceipt) | fires on **completion**, not payment; routes null client → "Walk-in" customer | **None** — QB is completion-driven and method-agnostic; SalesReceipt doesn't branch on cash vs card |
| 12 | CSV **exports** (`app/api/export/[entity]`) | clients columns = name/email/phone/created_at | **None — no export surfaces `payment_status`** |

### 1.1 ASSERTION (required): cash rows are invisible to reconcile + webhook
- **Reconcile cron** only selects rows at `payment_status='pending'`; a cash sale
  is written `'paid'` and never passes through `'pending'`, so the cron never
  sees it.
- **Webhook** (`updatePaymentStatusByIntent`) matches on `payment_intent_id`; a
  cash row has `payment_intent_id = null`, which no Stripe event can match.
- **Therefore** `markPaidCash` rows can never be flipped/clobbered by the two
  Stripe reconciliation paths. This is a hard invariant the cash action relies
  on (it writes no PI, never `'pending'`).

### 1.2 Tip at the counter (decided for step 1)
`tip_amount_cents` keeps its booking-time value; **the counter flow does not
add or edit tips in step 1.**
- **Card**: `chargeAppointment(amount_cents)` is caller-specified — charge
  `total_amount + tip_amount_cents` (tip already on the row).
- **Cash**: `markPaidCash` records the sale; it does **not** touch
  `tip_amount_cents`. A **cash tip on a card payment** (barber pockets cash, card
  pays the service) is a genuine real-world case but a **step-2** concern — it
  needs a tip-entry UI and a "cash tip" ledger. **Open question for the operator**
  (§9 Q3). Until then, cash tips are recorded by editing the appointment's tip
  before closing, same as today.

---

## 2. Step 2 — walk-in creation

### Why it's blocked & why downstream is already safe
`app/[locale]/(app)/schema.ts:6` — `client_id: z.string().uuid()` (required) is
the **only** lock. Everything downstream was already made walk-in-safe
(`appointments.client_id` nullable, `client_name_snapshot`, the QB "Walk-in"
fallback, null-guarded charge/receipts). `createAppointment` even comments
"back-dating a walk-in already served" (`actions.ts:182`).

### Schema delta (`schema.ts` `appointmentSchema`)
```ts
client_id: z.string().uuid().nullable(),               // was required
walk_in: z.boolean().optional().default(false),        // UI toggle
client_name: z.string().trim().max(120).nullable()     // → client_name_snapshot
  .or(z.literal('').transform(() => null)).optional(),
// + superRefine: walk_in === false ⇒ client_id required;
//                walk_in === true  ⇒ client_id must be null (use client_name)
```

### `createAppointment` action delta (`actions.ts`)
1. **Skip the client-belongs-to-shop check for walk-ins.** Today `:159-167`
   does `.eq('id', input.client_id)` and returns `NOT_FOUND` on no row — a null
   `client_id` would fail it. Guard: `if (input.client_id) { …check… }`.
2. **Write the snapshot.** The insert `:228` sets `client_id` but **not**
   `client_name_snapshot`. Add `client_name_snapshot: input.walk_in ?
   input.client_name : null`. (Column already exists; insert just omits it.)
3. Everything else (availability, services, totals) is client-agnostic.

### Downstream checklist — verified AT THE CODE

| Consumer | Null-client behavior | Evidence (file:line) | Verdict |
|---|---|---|---|
| **Loyalty** `awardLoyaltyOnCompletion` | no-ops: `.eq('id', null).single()` → no row → `if (!client) return` | `lib/business/loyalty.ts:172-181`; called `actions.ts:377-382` | **Safe.** Tighten the param type to `string \| null` + add an explicit `if (!clientId) return` for honesty (today's type claims `string`) |
| **Review request** `sendReviewRequestOnCompletion` | explicit early return | `lib/business/review-request.ts:51,54` (`clientId: string \| null` → `if (!clientId) return`) | **Safe, already correct** |
| **Reminders cron** | client join is null → skip (no email) | `app/api/cron/notifications/route.ts:60,113,238,248` (`if (!appt.client …) continue`, `!appt.client.email`) | **Safe.** Walk-ins are typically same-day anyway (no future reminder) |
| **QuickBooks** | null client → shop's "Walk-in" customer | `lib/quickbooks/sync.ts:73-75,162` | **Safe, already handled** |
| **Charge** | null-guarded email lookup | `actions.ts:1356-1360` | **Safe, already handled** |
| **Receipts / `/me`** | null-guarded | (Phase 72 null-guards noted in `actions.ts:936`) | **Safe** |

**Net:** walk-in is a **3-line-ish** change (schema + 2 action tweaks) plus the
loyalty type-tightening; no downstream consumer needs new logic.

---

## 3. Step 3 — the "Encaisser" (charge) drawer flow

Entry point: a manager+ **"Encaisser"** section in the appointment detail drawer
(`appointment-detail-drawer.tsx`), shown when `payment_status !== 'paid'`.

### 3a. Card — reuse `chargeAppointment` + copy the wizard's Elements pattern
- Drawer "Payer par carte" → call **`chargeAppointment(id, amount_cents =
  total_amount + tip_amount_cents)`** (existing action, `actions.ts:1294`,
  manager+, 20/hr, returns `{clientSecret, paymentIntentId}`).
- Mount a **Stripe Elements modal** copied from
  `app/[locale]/book/[shopSlug]/booking-payment-section.tsx` (`<Elements>` +
  `<PaymentElement>` + `useStripe/useElements`, mount-from-`clientSecret`,
  `confirmPayment` exposed via ref). Set `payment_method='card_counter'` on the
  charge.
- On confirm → PI succeeds → webhook flips `payment_status` to `'paid'` →
  optimistic drawer refresh / revalidate.
- **States to handle** (all already expressible from the action's returns):
  - `already_paid` → `err('CONFLICT', {payment:'already_paid'})` (`:1344`) → hide/disable the button.
  - `not_connected` → `err('INVALID_INPUT', {stripe:'not_connected'})` (`:1339`) → "Stripe pas connecté — encaisser en comptant".
  - `declined` → Elements `confirmPayment` returns a Stripe error → inline error, PI stays open for retry.
  - `processing` → PI `pending` until the webhook lands → spinner + "en traitement"; the row reconciles via webhook (or the reconcile cron as backstop).

### 3b. Cash — new action `markPaidCash` (manager+, idempotent, audited)
```ts
// schema: z.object({ id: z.string().uuid() })   // amount NOT editable (§3c)
export const markPaidCash = withAction({ schema, minRole: 'manager', run: async (input, ctx) => {
  // load appt (shop-scoped); reject cross-shop
  // IDEMPOTENT: if already paid → err('CONFLICT', {payment:'already_paid'})
  // UPDATE appointments SET payment_status='paid', payment_method='cash'
  //   WHERE id = … AND shop_id = … AND payment_status <> 'paid'
  // (writes NO payment_intent_id, never 'pending' → invisible to reconcile/webhook §1.1)
  // logDurableAudit({ action:'custom', entity:'appointments',
  //   diff:{ marked_paid_cash:true, amount: total_amount } })
}});
```
- Drawer "Payé comptant" button → **ConfirmDialog** ("Confirmer l'encaissement
  comptant de $X ?") → `markPaidCash`.
- **Idempotent** via the `payment_status <> 'paid'` WHERE clause (a double-click
  can't double-record); a second call returns `already_paid`.
- **Refund of cash = OUT OF SCOPE step 1** — a cash refund is a drawer-out event
  with no Stripe leg; needs its own action + drawer math. Note it; the Stripe
  refund path stays for card rows only (`canRefund` already requires a PI).

### 3c. Amount is NOT editable at the counter (step 1)
The charged/recorded amount is the appointment's `total_amount` (+ tip). Price
changes happen by **editing the appointment's services** (which re-derives
`total_amount`), not by typing a counter override. Keeps step 1 small and keeps
finances/commissions consistent with the booked services. (Editable counter
totals = step 2, with line-items.)

---

## 4. Step 4 — finances impact memo (model A)

### What changes meaning
- **`finances/today` drawer (`:142-153`) — the only rewrite.** Replace the
  `unpaid`-based drawer cash with:
  ```ts
  const cashPaid = completed.filter(a =>
    a.payment_method === 'cash'                                  // new cash sales
    || (a.payment_method == null && a.payment_status === 'unpaid')); // legacy compat
  const drawerCash = cashPaid.reduce((s,a)=>s+Number(a.total_amount??0),0);
  // expectedDrawer = cashDrawerStart + drawerCash + cash tips on cashPaid
  ```
  The `(method IS NULL AND status='unpaid')` clause means **historical rows need
  NO backfill** — a pre-migration cash sale (still `unpaid`, `method` null) keeps
  counting in the drawer for old close-out dates; new cash sales use
  `method='cash'`. The "paid" breakdown card now splits **card** vs **cash**.
- **`super-admin:88` — must add `payment_intent_id is not null`** so cash doesn't
  inflate platform-fee revenue (the platform fee only accrues on Stripe charges).
- **Receipt label** (nice-to-have): a "Payé (comptant)" variant.

### Backfill story
- `payment_method` is **nullable, default null** = "legacy / unknown". No data
  migration. The drawer's legacy-compat clause (above) makes the null cohort
  behave exactly as today. New writes set the method explicitly.

### Commissions — UNCHANGED in step 1 (divergence flagged)
- The commission engine consumes **completed `total_amount`** (reserved/earned),
  not collected money (`/finances` filters `status='completed'`, never
  `payment_status`). **Leave it unchanged in step 1.**
- **Flagged divergence:** once cash is recorded, "earned" (completed) and
  "collected" (paid) genuinely diverge for uncollected completes. Commissions on
  *earned* is the defensible default (the barber did the work), but a shop that
  pays commission only on *collected* money will want a toggle — **step 2 / an
  operator question**, not step 1.

---

## 5. Migration sketch (one column)

```sql
-- payment_method: how a collected payment was taken. NULL = legacy/uncollected.
create type payment_method as enum ('card_online','card_counter','cash');
alter table public.appointments
  add column if not exists payment_method payment_method;  -- nullable, no default
-- (optional, deferred) backfill historical card rows:
--   update appointments set payment_method='card_online'
--     where payment_status='paid' and payment_intent_id is not null;
-- left OUT of step 1 — the drawer's null-compat clause makes it unnecessary.
```
No RLS change (same row, existing policies). No index needed (filters are over
the already-day-bounded finances/today set).

## 6. The two action signatures

```ts
// existing — reused as-is for the card path (set method on the charge update)
chargeAppointment(input: { id: uuid; amount_cents: int }): { clientSecret; paymentIntentId }

// new — cash
const markPaidCashSchema = z.object({ id: z.string().uuid() });
markPaidCash(input): Result<{ id: string }>   // manager+, idempotent, durable audit, no Stripe
```

## 7. UI deltas
- **Form modal** (`client-form` for appointments): a **"Walk-in" toggle** → hides
  the client picker, shows an optional **"Nom (optionnel)"** free-text →
  `client_name`. i18n fr+en.
- **Detail drawer**: an **"Encaisser"** block (manager+, when not paid): "Payer
  par carte" (Elements modal) + "Payé comptant" (ConfirmDialog → `markPaidCash`).
- **finances/today**: "Paiements" card splits **Carte / Comptant / Impayé**;
  drawer line reads from the new cash set.

## 8. Test plan sketch
- **Unit / harness (plan 015 actions harness):**
  - `markPaidCash`: happy (unpaid→paid+cash, audit written); **idempotent**
    (second call → `already_paid`, no double write); cross-shop → `NOT_FOUND`;
    writes **no** `payment_intent_id` and never `'pending'` (the §1.1 invariant).
  - `chargeAppointment`: happy (→ pending + clientSecret), `already_paid`,
    `not_connected`; (declined is an Elements-side path — e2e).
  - `createAppointment` walk-in: `client_id=null` + `client_name` →
    `client_name_snapshot` set, client-shop check skipped; loyalty/review/QB
    no-op on null client.
- **e2e (Playwright, fresh-DB gated like calendar):** create a walk-in → mark
  paid cash → `/finances/today` drawer reflects it under Comptant.

## 9. Staged build order + effort + operator questions

### Build order (staged — walk-in first, it's independent)
1. **Walk-in creation** — schema nullable + toggle UI + snapshot insert +
   loyalty type-tighten. **Independent, ships alone. Effort: S.**
2. **Cash recording** — `payment_method` migration + `markPaidCash` +
   `finances/today` drawer rework + super-admin fix + ConfirmDialog button.
   **Effort: M.**
3. **Card "Encaisser"** — Elements modal (copy wizard) wired to
   `chargeAppointment` + the 4 states. **Effort: M.**

| Stage | Effort |
|---|---|
| 1 — walk-in | **S** |
| 2 — cash + drawer | **M** |
| 3 — card UI | **M** |
| **Total step 1** | **~L** (matches the plan's L estimate) |

### Open questions for the operator
1. **Cash model A** — confirm: add `payment_method`, cash ⇒ `paid` (recommended),
   vs keep "cash = unpaid forever" (B)? (Engineering strongly recommends A.)
2. **Who may charge/record?** Step-1 default = **manager+** (mirrors
   `chargeAppointment`). Should a **barber close their OWN** appointments
   (barber-own scope)? Ties into spike 027 (role clarity).
3. **Tip at the counter** — step 1 keeps booking-time tips only. Do you need
   **cash-tip-on-card** entry (barber takes a cash tip while the card pays the
   service)? That's a step-2 tip-entry UI + ledger.
4. **Commission basis** — keep commissions on **earned** (completed) totals
   (step-1 default), or add a **collected-only** toggle (step 2)?
5. **Cash refund** — out of scope step 1 (Stripe refunds stay card-only). When a
   shop needs to refund a cash sale, is a manual drawer-out note acceptable
   until step 2?
