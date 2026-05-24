import { describe, expect, it } from 'vitest';
import {
  activeTierIndex,
  computeCommission,
  normalizeTiers,
  type CommissionTierRow,
} from './commissions';

// Olivier's tiers from the Axum seed (annexe Image 5).
const OLIVIER_TIERS: CommissionTierRow[] = [
  { threshold: 0, pct: 55 },
  { threshold: 1000, pct: 60 },
  { threshold: 2000, pct: 65 },
  { threshold: 2500, pct: 70 },
  { threshold: 30000, pct: 100 },
];

// Arsh's tiers — all zeroes (i.e. no commission).
const ARSH_TIERS: CommissionTierRow[] = Array.from({ length: 5 }, () => ({
  threshold: 0,
  pct: 0,
}));

describe('normalizeTiers', () => {
  it('drops the all-zero "inactive" rows', () => {
    expect(normalizeTiers(ARSH_TIERS)).toEqual([]);
  });

  it('keeps the first row even if threshold=0 when pct > 0', () => {
    const tiers = normalizeTiers([{ threshold: 0, pct: 55 }]);
    expect(tiers).toEqual([{ threshold: 0, pct: 55 }]);
  });

  it('sorts by threshold', () => {
    const tiers = normalizeTiers([
      { threshold: 2000, pct: 65 },
      { threshold: 0, pct: 55 },
      { threshold: 1000, pct: 60 },
    ]);
    expect(tiers.map((t) => t.threshold)).toEqual([0, 1000, 2000]);
  });
});

describe('computeCommission — non-cumulative', () => {
  const cfg = { cumulative: false, tiers: OLIVIER_TIERS };

  it('returns 0 when revenue is 0', () => {
    expect(computeCommission(0, cfg)).toBe(0);
  });

  it('applies tier1 below the second threshold', () => {
    expect(computeCommission(500, cfg)).toBe(roundCents(500 * 0.55));
  });

  it('applies tier2 between $1000 and $2000', () => {
    expect(computeCommission(1500, cfg)).toBe(roundCents(1500 * 0.6));
  });

  it('applies tier3 between $2000 and $2500', () => {
    expect(computeCommission(2200, cfg)).toBe(roundCents(2200 * 0.65));
  });

  it('applies tier5 (100%) when revenue ≥ $30000', () => {
    expect(computeCommission(35000, cfg)).toBe(35000);
  });

  it('returns 0 when every tier is inactive (Arsh)', () => {
    expect(computeCommission(5000, { cumulative: false, tiers: ARSH_TIERS })).toBe(0);
  });
});

describe('computeCommission — cumulative', () => {
  const cfg = { cumulative: true, tiers: OLIVIER_TIERS };

  it('only first band applies for low revenue', () => {
    expect(computeCommission(500, cfg)).toBe(roundCents(500 * 0.55));
  });

  it('mixes tier1 (0–1000) and tier2 (1000–2000) on $1500', () => {
    // 55% × 1000 + 60% × 500
    const expected = 1000 * 0.55 + 500 * 0.6;
    expect(computeCommission(1500, cfg)).toBe(roundCents(expected));
  });

  it('crosses three tiers on $2400', () => {
    // 55%×1000 + 60%×1000 + 65%×400
    const expected = 550 + 600 + 260;
    expect(computeCommission(2400, cfg)).toBe(roundCents(expected));
  });

  it('saturates at 100% on the top band', () => {
    // 55×1000 + 60×1000 + 65×500 + 70×27500 + 100×5000
    const expected = 550 + 600 + 325 + 19250 + 5000;
    expect(computeCommission(35000, cfg)).toBe(roundCents(expected));
  });
});

describe('activeTierIndex', () => {
  it('returns -1 when below every tier or all-inactive', () => {
    expect(activeTierIndex(0, ARSH_TIERS)).toBe(-1);
  });

  it('returns the highest applicable tier index', () => {
    expect(activeTierIndex(2400, OLIVIER_TIERS)).toBe(2); // tier3 (2000)
    expect(activeTierIndex(35000, OLIVIER_TIERS)).toBe(4); // tier5 (30000)
  });
});

function roundCents(x: number): number {
  return Math.round(x * 100) / 100;
}
