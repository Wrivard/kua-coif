# 045 OUTPUT — Receipt TPS/TVQ breakdown: design

> Spike output for plan 045 (2026-06-11, executed at `07245a4`). Design only —
> nothing shipped. Verdict up front: **no STOP** — the tax lines CAN be
> guaranteed to reconcile with the charged amount, but only with the exact
> construction in §1/§2 (informative "included" lines + a DERIVED net base,
> never three independently-rounded numbers added together).

## TL;DR — the three facts that shape everything

1. **Taxes are inclusive in this repo by default.** `taxes.add_to_price`
   defaults to `true` (`20260523000001_init_schema.sql:195`) and means "the
   listed price already includes this tax" (`lib/business/taxes.ts:5-7,18-19`);
   the seed creates TPS 5% / TVQ 9.975% both `add_to_price=true`, and
   `taxes.test.ts:25-33` pins "Quebec default — TPS + TVQ already in price".
2. **No charged amount ever goes through the tax engine.**
   `computeTaxedAmount` has ZERO production call sites (grep: only
   `taxes.ts`/`taxes.test.ts`). The charge formula
   (`lib/business/booking-pricing.ts`, plan 014's single source) is
   `Σ listed prices − promo − loyalty (+ tip)`; admin create is `Σ price`.
   So for inclusive taxes the charge is already tax-in by convention, and a
   receipt breakdown is pure PRESENTATION of the same number — while an
   EXCLUSIVE tax (`add_to_price=false`) is never added to any charge
   (pre-existing gap, §2/§5).
3. **`shops` has NO registration-number columns** (full DDL reviewed,
   `init_schema.sql:57-100`; grep for `tps|tvq|tax_number|registration` over
   migrations + `db/types.ts` is empty) → migration designed in §3. Also:
   `appointment_services` snapshots ONLY `price_snapshot`
   (`init_schema.sql:310-315`) — there is no tax snapshot, so a rendered
   breakdown uses TODAY's tax links, not booking-day's (§2 risk, §5).

## 1. Data path (receipt → links → taxes → decomposition)

**Fetch** — extend the receipt page's existing second query
(`receipt/[token]/page.tsx:88-91`) with the service id + nested links, one
service-role round-trip, no extra query:

```ts
.from('appointment_services')
.select(`price_snapshot,
         service:services(id, name,
           service_tax_links(tax:taxes(name, percentage, add_to_price,
                                       external_orders_only, enabled)))`)
.eq('appointment_id', appt.id)
```

Add `tps_number, tvq_number` (§3) to the appointment query's `shop:shops(…)`
projection. Filter each line's taxes to `enabled === true` AND
`external_orders_only === false` (that flag scopes a tax to external product
orders — never to a service receipt).

**Decomposition** — per LINE, with the EXISTING helper and the same inputs the
charge used (the snapshot price):

```ts
computeTaxedAmount(line.price_snapshot, taxesOfThatService) // lib/business/taxes.ts:41
```

"Same precedence as the charge" means, concretely (since the charge never
calls the engine): decompose the SAME `price_snapshot` dollars the charge
summed, treat `add_to_price=true` amounts as already inside that price, and
never let a tax line change any total. Per-line results are then scaled by the
discount (§2, pro-rata) and summed into at most one line per distinct tax
name.

**The reconciliation guarantee (the STOP question)** — `computeTaxedAmount`
rounds `netBase` and each tax INDEPENDENTLY, so re-adding its outputs can
miss the price by a cent: `$34.79` decomposes to `30.26 + 1.51 + 3.02 =
34.79` ✓, but `$10.00` decomposes to `8.70 + 0.44 + 0.87 = $10.01` ✗ (net
`round(1000/1.14975)=870`¢, TPS `round(43.5)=44`¢, TVQ `round(86.78)=87`¢).
Therefore the receipt must NEVER print three independently-rounded numbers
that claim to sum:

- Tax lines are rendered as **informative "included" lines** — « dont TPS
  (5 %) : 0,44 $ » — outside the addition column. The displayed totals
  (`subtotal`, `discount`, `tip`, `total`) keep today's exact arithmetic
  (`receipt-client.tsx:72-76`), so the TOTAL CANNOT change. 
- If a net-of-tax line is shown (« Sous-total hors taxes »), it is **DERIVED**
  as `taxedBase − Σ included-tax lines` — absorbing the rounding residue —
  never `netBase` from the engine. With that rule, `netHT + TPS + TVQ ≡
  taxed base` holds at the cent, always, by construction.

This is the guarantee: **structural (taxes never enter the addition; the only
derived line absorbs rounding), not numerical luck.** The build must still
ship the regression test the plan asks for (seed prices `34.79`, `43.49`,
`13.05`, plus the `$10.00` pathological case) asserting the printed lines
reconcile.

## 2. Edge cases (and every place the recomputation could diverge)

| Case | Render | Divergence risk → rule |
|---|---|---|
| Exempt service (no rows in `service_tax_links`) | No tax attributed to that line; its full price is untaxed base | None — engine returns empty breakdown |
| All services share TPS+TVQ inclusive (the overwhelmingly common Québec shape) | Two « incluse » lines computed on the post-discount base | None with §1's construction |
| **Exclusive tax** (`add_to_price=false`) | **V1: render NO tax line for it** | HIGH if rendered: booking-pricing never charged it, so an « ajoutée » line would claim money that was not collected. Showing nothing is honest; fixing the charge is a separate money-path plan (§5-Q1) |
| Service with multiple taxes | One line per tax name, summed across services | None — engine is non-compounded (each tax applies to the same net base, `taxes.ts:4-5,58-63`) |
| Discount (promo and/or loyalty) | Taxes computed on the **post-discount** base: scale each line's engine output by `total_amount / Σ price_snapshot` (pro-rata), then round once per tax | The charge applied discounts AFTER summing tax-in prices (`booking-pricing.ts:66-88`); a discount-before-tax receipt (standard QC practice — the rebate reduces the taxable base) must therefore pro-rate. With heterogeneous tax sets + a discount, pro-rata is an allocation CHOICE (defensible, deterministic) — flag in the build test |
| Tip | Untaxed (Québec: gratuities carry no TPS/TVQ); stays a separate line as today (`tip_amount_cents`, outside `total_amount`) | None — never enters the taxed base |
| Deposit / balance | Payment split only; renders after the total as today | None — no tax effect |
| `external_orders_only=true` tax linked to a service | Excluded by the fetch filter | Would inflate lines if forgotten — that's why the filter is in §1 |
| **Tax config changed since booking** | V1 renders with CURRENT links/rates on the SNAPSHOT prices | REAL divergence vector: no tax snapshot exists (`appointment_services` has only `price_snapshot`). An old receipt re-printed after a rate/link change shows different included-tax lines than the customer's original. Accepted for V1 (totals still exact — only the informative split moves); V2 option in §5-Q2 |
| Refunded / partially-charged states | Breakdown reflects `total_amount` regardless of `payment_status` (the receipt already renders status separately) | None — status chip unchanged |

The taxed base for the lines is `total_amount` (services after promo+loyalty,
tax-in, tip excluded — confirmed by `receipt-client.tsx:62-76` and
`booking-pricing.ts`), allocated per line pro-rata when a discount exists.

## 3. Registration numbers (schema + capture + absent-state)

**Schema — columns do not exist; migration:**

```sql
-- supabase/migrations/<ts>_shop_tax_registration_numbers.sql
alter table public.shops
  add column tps_number text,
  add column tvq_number text;
comment on column public.shops.tps_number is
  'GST/TPS registration (e.g. 123456789RT0001). Display-only on receipts; never log.';
comment on column public.shops.tvq_number is
  'QST/TVQ registration (e.g. 1234567890TQ0001). Display-only on receipts; never log.';
```

No DB-level format CHECK (legacy registrations vary); nullable text. RLS:
`shops` policies already gate updates (manager+ via existing
`updateShopDetails` path) — columns ride along, no new policy. The receipt
reads them via the service-role projection (§1) — public display is the
point; the plan's note stands: display-only, never in logs/Sentry.

**Capture — `/settings/shop` (Shop details)**: add a « Numéros de taxes »
field pair next to the business-location block
(`shop-details-client.tsx:233-253`), wired through the existing
`shopDetailsSchema` (`settings/shop/schema.ts:11`) with normalize-then-
validate zod: trim, strip inner spaces, uppercase, then
`/^\d{9}RT\d{4}$/` (TPS) and `/^\d{10}TQ\d{4}$/` (TVQ), each
`.or(z.literal('').transform(() => null))` like the file's `optionalText`
pattern. (Alternative considered: `/settings/taxes` — rejected; the numbers
are shop-level legal identity, not per-tax rows, and Shop details already
holds the legal address the receipt prints.)

**When absent** — render NOTHING, and **gate each tax line on its number**:
the TPS line renders only if `tps_number` is set, TVQ only if `tvq_number`
is. Rationale: printing « non inscrit » asserts a legal status we can't
verify (small salons under the $30k threshold are legitimately unregistered),
and Québec rules require the registration numbers on a receipt that shows the
taxes — so no number ⇒ no tax line ⇒ the receipt stays exactly today's
(tax-in prices, no decomposition), which is the safe status quo. This rule
also makes the rollout self-serve: the breakdown appears the day the owner
fills the numbers in.

## 4. UI design (totals block + footer, bilingual)

The receipt deliberately uses a local `L` object (fr/en inline,
`receipt-client.tsx:90-142`) instead of next-intl — follow that pattern
(plan 041 will consolidate token-page i18n later; don't pre-empt it here).

**Totals block** (`receipt-client.tsx:287-312`) — unchanged rows, then the
included-tax lines between the Total row and the deposit block, visually
subordinate (they are informative, not addends):

```
Sous-total                                   78,28 $
Rabais                                      −10,00 $
Pourboire                                     5,00 $
────────────────────────────────────────────────────
Total                                        73,28 $
  dont TPS (5 %) · nº 123456789 RT0001        2,97 $
  dont TVQ (9,975 %) · nº 1234567890 TQ0001   5,92 $
Acompte payé                                −20,00 $
Solde à payer en salon                       53,28 $
```

- Style: `text-xs text-text-muted print:text-gray-700`, indented under Total,
  `font-mono tabular-nums` amounts (reuse `Row` with a `muted` variant or a
  sibling `TaxRow` — match the existing component, don't restyle the block).
- Labels: fr « dont TPS (5 %) incluse » / en "incl. GST (5%)" ; fr « dont
  TVQ (9,975 %) incluse » / en "incl. QST (9.975%)". Percentages come from
  the tax ROWS (never hardcode 5/9.975 — the engine renders whatever the
  shop configured; format the rate with the locale's decimal separator).
- Registration numbers: render inline on the tax line (as above) OR as a
  one-line footer under « Merci pour votre visite ! » —
  `N° TPS : 123456789 RT0001 · N° TVQ : 1234567890 TQ0001` — pick ONE in the
  build; the footer reads better on narrow print and is the recommendation
  (keeps the totals column clean). Space-group the numbers for legibility
  (`123456789 RT0001`), `text-[10px] text-center text-text-muted
  print:text-gray-700`.
- Optional « Sous-total hors taxes » line: SKIP in V1. Tax-in pricing with
  « dont … » lines is the standard Québec salon receipt; a derived net line
  adds a row and a divergence surface for zero customer value. (If a future
  request adds it, it MUST be derived per §1.)
- The `?print=1` flow, print stylesheet and the header claim (« suitable for
  Quebec tax records », `receipt-client.tsx:44-47`) need no change — the
  claim finally becomes true.

## 5. Open questions + phased build order

1. **Exclusive taxes are never charged online** (`booking-pricing.ts` ignores
   `add_to_price=false` entirely; admin create too). The receipt design
   sidesteps it (no line rendered), but the charge gap is a real money bug
   for any shop that configures an exclusive tax — needs its OWN plan
   (money-path, MED risk, parity tests). Decide whether to build it before
   or after this receipt work.
2. **No tax snapshot at booking time.** V1 renders current links/rates over
   snapshot prices (divergence documented in §2). V2 option: persist
   `tax_lines jsonb` (name, percentage, add_to_price) on
   `appointment_services` at create/charge time — small migration, makes
   re-prints immutable. Recommend: ship V1, snapshot in the same release as
   open question 1's fix (both touch the charge path).
3. **Discount pro-rata across heterogeneous tax sets** (taxed + exempt lines
   + a promo): pro-rata by line price is the chosen allocation; confirm with
   the owner-facing accountant story before build (it changes nothing for
   single-set shops like the seed).
4. **Trigger surface**: this spike covers the receipt page. The confirmation
   email's amount block and `/me` hub render totals too — decide whether the
   tax lines extend there in the same build (recommend: receipt only first;
   email second once the receipt's math test is green).
5. **Telemetry/PII**: registration numbers are public-by-nature on receipts
   but must never hit logs (plan note). The build must keep them out of
   `logDurableAudit` payloads and Sentry breadcrumbs.

**Phased build order** (each phase independently shippable):

1. **Migration + capture** — `tps_number`/`tvq_number` columns, zod +
   `/settings/shop` fields, `db:types` regen. No receipt change yet (gating
   means nothing renders until numbers exist anyway).
2. **Receipt decomposition + lines** — extend the two receipt queries (§1),
   per-line `computeTaxedAmount` + pro-rata discount scaling, gated tax
   lines + footer numbers, fr/en labels; the reconciliation regression test
   (seed fixtures + the `$10.00` rounding case) from `taxes.test.ts`'s
   fixtures, per the plan's maintenance note.
3. **(Separate plans)** — exclusive-tax charging fix (Q1) + tax snapshot
   (Q2), email/me parity (Q4).
