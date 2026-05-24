/**
 * Commission calculations — pure, testable.
 *
 * A barber has 5 tier rows: each row is a (threshold, percentage) pair. The
 * thresholds are cumulative gross revenue (CA) breakpoints.
 *
 * Two modes:
 *
 *  - Non-cumulative (default): we find the highest tier whose threshold is
 *    ≤ revenue and apply that tier's percentage to the *whole* revenue.
 *      e.g. tiers [(0,55), (1000,60), (2000,65)] on $1500 → 60% × 1500 = $900
 *
 *  - Cumulative: each tier applies to the portion between its threshold and
 *    the next tier's threshold.
 *      e.g. same tiers on $1500 → 55% × 1000 + 60% × 500 = $850
 *
 * Inactive tiers — where both threshold and pct are 0 — short-circuit and
 * mean "no commission earned in that band". This matches the Axum seed where
 * Arsh has every tier at (0, 0%).
 */

export type CommissionTierRow = {
  threshold: number;
  pct: number;
};

export type CommissionTiers = {
  cumulative: boolean;
  tiers: ReadonlyArray<CommissionTierRow>;
};

/**
 * Build a normalised, sorted list of tiers. Filters out the "all zero"
 * configuration (which means no commissions).
 */
export function normalizeTiers(input: ReadonlyArray<CommissionTierRow>): CommissionTierRow[] {
  return [...input]
    .filter((t) => t.pct > 0 || t.threshold > 0)
    .sort((a, b) => a.threshold - b.threshold);
}

/**
 * Compute commission earned on a given gross revenue.
 *
 * @returns the commission amount in dollars, rounded to cents.
 */
export function computeCommission(revenue: number, config: CommissionTiers): number {
  const tiers = normalizeTiers(config.tiers);
  if (tiers.length === 0 || revenue <= 0) return 0;

  if (!config.cumulative) {
    // Find the highest tier whose threshold ≤ revenue.
    let pct = 0;
    for (const t of tiers) {
      if (revenue >= t.threshold) pct = t.pct;
    }
    return roundCents(revenue * (pct / 100));
  }

  // Cumulative: walk the tiers, applying each pct to the slice between
  // the current threshold and the next one (or revenue, whichever comes first).
  let total = 0;
  for (let i = 0; i < tiers.length; i += 1) {
    const cur = tiers[i]!;
    if (revenue <= cur.threshold) break;
    const next = tiers[i + 1];
    const upperBound = Math.min(next?.threshold ?? Infinity, revenue);
    const slice = upperBound - cur.threshold;
    if (slice > 0) total += slice * (cur.pct / 100);
  }
  return roundCents(total);
}

/** Helper: highest applicable tier index for a non-cumulative config. */
export function activeTierIndex(revenue: number, tiers: ReadonlyArray<CommissionTierRow>): number {
  const sorted = normalizeTiers(tiers);
  let idx = -1;
  for (let i = 0; i < sorted.length; i += 1) {
    if (revenue >= sorted[i]!.threshold) idx = i;
  }
  return idx;
}

function roundCents(x: number): number {
  return Math.round(x * 100) / 100;
}
