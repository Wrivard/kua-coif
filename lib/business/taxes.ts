/**
 * Pure tax calculations — no Supabase, no React, fully testable in Vitest.
 *
 * Quebec uses two taxes: TPS (federal, 5%) and TVQ (provincial, 9.975%). Both
 * are non-compounded (each applies to the pre-tax base). The shop owner can
 * choose `add_to_price` per tax — if true, the displayed price already
 * includes the tax; if false, the tax is applied on top at checkout.
 *
 * We return amounts in cents internally to dodge floating-point drift, then
 * convert back to dollars at the boundary.
 */

export type TaxLine = {
  /** Free-form name shown to the user, e.g. "TPS", "TVQ". */
  name: string;
  /** Percent e.g. 5 for 5%, 9.975 for TVQ. */
  percentage: number;
  /** If true, the base price is already inclusive of this tax. */
  add_to_price: boolean;
};

export type TaxedAmount = {
  /** Sum the customer pays, in dollars. */
  total: number;
  /** What the salon keeps (base before taxes), in dollars. */
  netBase: number;
  /** Tax breakdown: name → amount in dollars. */
  breakdown: Record<string, number>;
};

function roundCents(x: number): number {
  return Math.round(x);
}

/**
 * Compute taxed total for a line item.
 *
 * @param price the listed price the user sees (dollars, possibly tax-inclusive)
 * @param taxes the taxes that apply to this item
 */
export function computeTaxedAmount(price: number, taxes: ReadonlyArray<TaxLine>): TaxedAmount {
  // Convert to cents once.
  const priceCents = roundCents(price * 100);

  // Sum the percentages of "add_to_price" taxes — these are already baked
  // into the listed price, so we have to back them out to find the net base.
  const inclusiveRate = taxes
    .filter((t) => t.add_to_price)
    .reduce((sum, t) => sum + t.percentage, 0);

  // netBase = priceCents / (1 + inclusiveRate/100). If no inclusive tax,
  // priceCents IS the net base.
  const netBaseCents = roundCents(priceCents / (1 + inclusiveRate / 100));

  const breakdown: Record<string, number> = {};
  let taxTotalCents = 0;

  for (const t of taxes) {
    const taxCents = roundCents((netBaseCents * t.percentage) / 100);
    breakdown[t.name] = taxCents / 100;
    if (!t.add_to_price) {
      taxTotalCents += taxCents;
    }
  }

  const totalCents = priceCents + taxTotalCents;

  return {
    total: totalCents / 100,
    netBase: netBaseCents / 100,
    breakdown,
  };
}

/**
 * Helper: total customer payment for an array of items.
 */
export function computeLineItemsTotal(
  items: ReadonlyArray<{ price: number; taxes: ReadonlyArray<TaxLine> }>,
): number {
  return items.reduce((sum, it) => sum + computeTaxedAmount(it.price, it.taxes).total, 0);
}
