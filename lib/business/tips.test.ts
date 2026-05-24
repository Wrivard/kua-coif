import { describe, expect, it } from 'vitest';
import { suggestTips, type TipsConfig } from './tips';

// Axum tips_config (annexe Image 15).
const AXUM: TipsConfig = {
  round_up: true,
  pct_tier1: 15,
  pct_tier2: 18,
  pct_tier3: 20,
  pct_tier4: 25,
  pct_use_above_amount: 10,
  flat_tier1: 2,
  flat_tier2: 3,
  flat_tier3: 4,
  flat_tier4: 5,
};

describe('suggestTips — small carts', () => {
  it('uses flat tiers when tipBase ≤ pct_use_above_amount', () => {
    const out = suggestTips(8, AXUM);
    expect(out).toHaveLength(4);
    expect(out.map((s) => s.kind)).toEqual(['flat', 'flat', 'flat', 'flat']);
    expect(out.map((s) => s.amount)).toEqual([2, 3, 4, 5]);
  });

  it('respects pct_use_above_amount as a strict-greater threshold', () => {
    // Exactly $10 → still flat (rule: greater-than, not equal).
    expect(suggestTips(10, AXUM)[0]?.kind).toBe('flat');
  });
});

describe('suggestTips — large carts', () => {
  it('uses percent tiers when tipBase > pct_use_above_amount', () => {
    const out = suggestTips(34.79, AXUM); // Axum Haircut
    expect(out.map((s) => s.kind)).toEqual(['percent', 'percent', 'percent', 'percent']);
    expect(out.map((s) => s.label)).toEqual(['15%', '18%', '20%', '25%']);
  });

  it('rounds up when round_up is on', () => {
    // 34.79 × 15% = 5.2185 → ceil → 6
    const [tier1] = suggestTips(34.79, AXUM);
    expect(tier1?.amount).toBe(6);
  });

  it('falls back to cent rounding when round_up is off', () => {
    const [tier1] = suggestTips(34.79, { ...AXUM, round_up: false });
    // 5.2185 → 5.22
    expect(tier1?.amount).toBeCloseTo(5.22, 2);
  });
});
