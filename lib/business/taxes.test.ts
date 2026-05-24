import { describe, expect, it } from 'vitest';
import { computeLineItemsTotal, computeTaxedAmount, type TaxLine } from './taxes';

// Canonical Quebec taxes — match the seed (annexe Image 16 of CLAUDE.md).
const TPS: TaxLine = { name: 'TPS', percentage: 5, add_to_price: true };
const TVQ: TaxLine = { name: 'TVQ', percentage: 9.975, add_to_price: true };
const TPS_EXCL: TaxLine = { name: 'TPS', percentage: 5, add_to_price: false };
const TVQ_EXCL: TaxLine = { name: 'TVQ', percentage: 9.975, add_to_price: false };

describe('computeTaxedAmount', () => {
  it('returns the price as-is when there are no taxes', () => {
    const r = computeTaxedAmount(10, []);
    expect(r.total).toBe(10);
    expect(r.netBase).toBe(10);
    expect(r.breakdown).toEqual({});
  });

  it('handles a single tax-inclusive tax (price stays the same, base is reduced)', () => {
    const r = computeTaxedAmount(10.5, [TPS]);
    expect(r.total).toBeCloseTo(10.5, 2);
    expect(r.netBase).toBeCloseTo(10.0, 2);
    expect(r.breakdown.TPS).toBeCloseTo(0.5, 2);
  });

  it('handles two tax-inclusive taxes (Quebec default — TPS + TVQ already in price)', () => {
    // Axum "Haircut" = $34.79 listed price, all-in (TPS+TVQ already baked).
    // Net base should be ~ $30.27 (34.79 / 1.14975).
    const r = computeTaxedAmount(34.79, [TPS, TVQ]);
    expect(r.total).toBeCloseTo(34.79, 2);
    expect(r.netBase).toBeCloseTo(30.26, 1);
    expect(r.breakdown.TPS).toBeGreaterThan(0);
    expect(r.breakdown.TVQ).toBeGreaterThan(0);
  });

  it('handles tax-exclusive taxes (added on top of listed price)', () => {
    const r = computeTaxedAmount(100, [TPS_EXCL, TVQ_EXCL]);
    // Total is rounded to cents (no fractional cents at the cash register).
    expect(r.total).toBeCloseTo(114.98, 2);
    expect(r.netBase).toBe(100);
    expect(r.breakdown.TPS).toBeCloseTo(5, 2);
    expect(r.breakdown.TVQ).toBeCloseTo(9.98, 2);
  });

  it('handles mixed inclusive + exclusive taxes', () => {
    // TPS is inclusive, TVQ is exclusive: base for TVQ is the post-inclusive net.
    const r = computeTaxedAmount(10.5, [TPS, TVQ_EXCL]);
    // After backing out 5% TPS → base ≈ 10.00, TVQ adds 9.975% → ≈ 0.998
    expect(r.netBase).toBeCloseTo(10.0, 2);
    expect(r.breakdown.TPS).toBeCloseTo(0.5, 2);
    expect(r.breakdown.TVQ).toBeCloseTo(0.998, 2);
    expect(r.total).toBeCloseTo(11.498, 2);
  });

  it('rounds to cents and never produces fractional cents in total', () => {
    const r = computeTaxedAmount(13.05, [TPS, TVQ]); // OLIVE OIL (mousse) seed price
    expect(Number.isInteger(Math.round(r.total * 100))).toBe(true);
  });
});

describe('computeLineItemsTotal', () => {
  it('sums independent items', () => {
    const total = computeLineItemsTotal([
      { price: 34.79, taxes: [TPS, TVQ] },
      { price: 43.49, taxes: [TPS, TVQ] },
    ]);
    expect(total).toBeCloseTo(34.79 + 43.49, 2);
  });

  it('returns 0 for an empty cart', () => {
    expect(computeLineItemsTotal([])).toBe(0);
  });
});
