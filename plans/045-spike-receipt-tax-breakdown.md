# Plan 045: SPIKE — render the Québec TPS/TVQ tax breakdown on the receipt

> **Executor instructions**: This is a DESIGN/SPIKE plan. The deliverable is a written
> design + open questions — NOT a shipped feature (the tax math on a customer receipt must
> match what was charged, and registration numbers likely need new schema, so design first).
> Write the output to `plans/045-OUTPUT-receipt-tax-design.md`. Do not modify product code.
> When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 9e6ce12..HEAD -- "app/[locale]/receipt/[token]" lib/business/taxes.ts db/rows.ts`

## Status

- **Priority**: P3
- **Effort**: M (spike — investigate + design; the build is a separate plan)
- **Risk**: LOW (design only) / the eventual build is MED (money math shown to customers)
- **Depends on**: plan 037 (token trust) and 044 (/me hub) touch nearby receipt/token code;
  this spike only READS. Coordinate the build with 045's design output.
- **Category**: direction
- **Planned at**: commit `9e6ce12`, 2026-06-10

## Why this matters

The receipt page renders only subtotal / discount / tip / total
(`receipt-client.tsx:~287-312`), yet its own header claims the artifact is "suitable for Quebec
tax records" (`receipt-client.tsx:~46-47`). The platform HAS a full TPS/TVQ engine —
`lib/business/taxes.ts` (`computeTaxedAmount`, inclusive/exclusive), `db/rows.ts` (`TaxRow`,
`ServiceTaxLinkRow`), a `/settings/taxes` page, and tests asserting "Quebec default — already in
price" (`lib/business/taxes.test.ts`). For any tax-registered salon, a receipt without
"TPS (5%) incluse / TVQ (9,975%) incluse" lines (+ registration numbers) isn't usable as the tax
record it claims to be — a trust + compliance gap on the money surface. Because the displayed tax
must match what was charged and registration numbers likely need new shop columns, this is a
spike, not a blind build.

## What the spike must produce (`plans/045-OUTPUT-receipt-tax-design.md`)

1. **Data path**: how the receipt page (`receipt/[token]/page.tsx`) fetches the appointment's
   service lines → their `service_tax_links` → `taxes`, and decomposes each via the EXISTING
   `computeTaxedAmount` helper, with the SAME precedence the POS/booking used (so the receipt
   matches the charge byte-for-byte). Confirm whether taxes are stored inclusive or exclusive in
   this repo and how that affects the lines shown.
2. **Edge cases**: exempt services, exclusive vs inclusive taxes, a service with multiple taxes,
   a discount applied before/after tax, a tip (untaxed). Specify how each renders. List any case
   where the receipt's recomputation could DIVERGE from the charged amount (that's the risk).
3. **Registration numbers**: TPS/TVQ registration numbers are legally required on a tax receipt.
   Determine whether `shops` has columns for them (likely not) — if not, design the migration
   (`tps_number`, `tvq_number`) + the `/settings/shop` fields to capture them, and decide how the
   receipt renders when they're absent (omit the lines? show "non inscrit"?).
4. **UI design**: the receipt totals block with included-tax lines + a footer with registration
   numbers, bilingual, matching the existing receipt styling.
5. **Open questions + build order**: risks (math divergence, missing reg numbers, exempt
   handling) and a phased build (read+decompose → render lines → reg-number capture).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Read the engine | (read) `lib/business/taxes.ts`, `lib/business/taxes.test.ts`, `db/rows.ts` | understand inclusive/exclusive + precedence |
| Read the receipt | (read) `app/[locale]/receipt/[token]/page.tsx` + `receipt-client.tsx` | current totals block |

## Scope

**In scope**: the OUTPUT design doc; reading the tax engine, the receipt page/client, and the
shop schema. **Out of scope**: shipping the feature or the migration (the design defines them).

## Done criteria

- [ ] `plans/045-OUTPUT-receipt-tax-design.md` exists with all five sections
- [ ] The design names the EXACT helper + precedence so the receipt math will match the charge
- [ ] The registration-number question is resolved (schema present? migration designed?)
- [ ] No product code changed (`git status` clean except the OUTPUT doc)
- [ ] `plans/README.md` row updated

## STOP conditions

- You cannot determine the precedence that guarantees the receipt matches the charged amount —
  STOP and report; shipping a receipt whose tax lines don't reconcile to the total is worse than
  not showing them.

## Maintenance notes

- The build that follows must add a test asserting the receipt's decomposed lines sum back to the
  charged total for the seed shop's services (reuse the `taxes.test.ts` fixtures).
- Registration numbers are PII-adjacent business identifiers — display only, never log.
