/**
 * Tip suggestion engine — pure, testable.
 *
 * The shop chooses two strategies that share one threshold:
 *
 *  - For small carts (basePrice ≤ pctUseAboveAmount), suggest **flat
 *    amounts** (`flat_tier1..4`, e.g. $2/$3/$4/$5).
 *  - For larger carts, suggest **percentages** (`pct_tier1..4`,
 *    e.g. 15/18/20/25 %).
 *
 * `round_up`, when on, rounds the displayed tip up to the next dollar.
 *
 * The tip base price normally excludes taxes & products, but the shop can
 * flip `use_taxes_in_tips` and `use_prod_price_in_tips`. Those toggles
 * live on the `shops` row and are passed in as `tipBase`.
 */

export type TipsConfig = {
  round_up: boolean;
  pct_tier1: number;
  pct_tier2: number;
  pct_tier3: number;
  pct_tier4: number;
  pct_use_above_amount: number;
  flat_tier1: number;
  flat_tier2: number;
  flat_tier3: number;
  flat_tier4: number;
};

export type TipSuggestion = {
  /** Type of suggestion shown to the user. */
  kind: 'percent' | 'flat';
  /** Underlying tier label (e.g. "15%" or "$2"). */
  label: string;
  /** Final amount in dollars (rounded per round_up). */
  amount: number;
};

function roundUp(x: number): number {
  return Math.ceil(x);
}
function roundCents(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * Compute the 4 tip options to show the customer.
 *
 * @param tipBase the dollar amount the tip percentage applies to (already
 *                including taxes/products if the shop opted in).
 * @param config  tips_config row.
 */
export function suggestTips(tipBase: number, config: TipsConfig): TipSuggestion[] {
  const usePercent = tipBase > config.pct_use_above_amount;

  if (usePercent) {
    const pcts = [config.pct_tier1, config.pct_tier2, config.pct_tier3, config.pct_tier4];
    return pcts.map((pct) => {
      const raw = tipBase * (pct / 100);
      const amount = config.round_up ? roundUp(raw) : roundCents(raw);
      return { kind: 'percent', label: `${pct}%`, amount };
    });
  }

  const flats = [config.flat_tier1, config.flat_tier2, config.flat_tier3, config.flat_tier4];
  return flats.map((amount) => ({
    kind: 'flat',
    label: `$${amount.toFixed(2)}`,
    amount: config.round_up ? roundUp(amount) : roundCents(amount),
  }));
}
