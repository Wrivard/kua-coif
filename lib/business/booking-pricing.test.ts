import { describe, expect, it } from 'vitest';
import {
  computeBookingPricing,
  type BookingPricingInput,
  type BookingPricingService,
} from './booking-pricing';

// Helper: build an input with sensible defaults so each test only states
// what it cares about.
function input(over: Partial<BookingPricingInput>): BookingPricingInput {
  return {
    paymentMode: 'full',
    services: [],
    promo: null,
    loyaltyBalanceCents: 0,
    tipAmountCents: 0,
    ...over,
  };
}

const svc = (price: number, deposit_amount_cents: number | null = null): BookingPricingService => ({
  price,
  deposit_amount_cents,
});

describe('computeBookingPricing — unit cases', () => {
  it('full / no promo / no loyalty / no tip → rounds the subtotal', () => {
    const r = computeBookingPricing(input({ services: [svc(30), svc(45)] }));
    expect(r.subtotalDollars).toBe(75);
    expect(r.discountDollars).toBe(0);
    expect(r.loyaltyCreditCents).toBe(0);
    expect(r.totalDollars).toBe(75);
    expect(r.tipCents).toBe(0);
    expect(r.chargeCents).toBe(7500);
  });

  it('full + percent promo → discount = subtotal * value / 100', () => {
    const r = computeBookingPricing(
      input({ services: [svc(75)], promo: { type: 'percent', value: 20 } }),
    );
    expect(r.discountDollars).toBe(15);
    expect(r.totalDollars).toBe(60);
    expect(r.chargeCents).toBe(6000);
  });

  it('full + fixed promo LARGER than subtotal → discount caps at subtotal (bill floors at 0)', () => {
    const r = computeBookingPricing(
      input({ services: [svc(50)], promo: { type: 'fixed', value: 80 } }),
    );
    expect(r.discountDollars).toBe(50);
    expect(r.totalDollars).toBe(0);
    expect(r.chargeCents).toBe(0);
  });

  it('full + loyalty smaller than total → credit applied, total reduced', () => {
    const r = computeBookingPricing(input({ services: [svc(100)], loyaltyBalanceCents: 2500 }));
    expect(r.loyaltyCreditCents).toBe(2500);
    expect(r.totalDollars).toBe(75);
    expect(r.chargeCents).toBe(7500);
  });

  it('loyalty LARGER than total → total floors at 0, credit = running cents (not the full balance)', () => {
    const r = computeBookingPricing(input({ services: [svc(20)], loyaltyBalanceCents: 5000 }));
    expect(r.loyaltyCreditCents).toBe(2000); // min(5000, round(20*100))
    expect(r.totalDollars).toBe(0);
    expect(r.chargeCents).toBe(0);
  });

  it('promo + loyalty stack in order (promo FIRST, then loyalty on the discounted total)', () => {
    const r = computeBookingPricing(
      input({
        services: [svc(100)],
        promo: { type: 'percent', value: 50 },
        loyaltyBalanceCents: 3000,
      }),
    );
    expect(r.discountDollars).toBe(50); // 50% of 100
    expect(r.loyaltyCreditCents).toBe(3000); // min(3000, round(50*100))
    expect(r.totalDollars).toBe(20); // 100 - 50 promo - 30 loyalty
    expect(r.chargeCents).toBe(2000);
  });

  it('deposit mode ignores promo + loyalty → charges sum of per-service deposit cents', () => {
    const r = computeBookingPricing(
      input({
        paymentMode: 'deposit',
        services: [svc(100, 1000), svc(100, 1500)],
        promo: { type: 'percent', value: 50 },
        loyaltyBalanceCents: 9999,
      }),
    );
    expect(r.chargeCents).toBe(2500); // 1000 + 1500, promo/loyalty ignored for the deposit
  });

  it('tip clamps at 100_000 cents ($1,000)', () => {
    const r = computeBookingPricing(input({ services: [svc(10)], tipAmountCents: 999_999 }));
    expect(r.tipCents).toBe(100_000);
    expect(r.chargeCents).toBe(1000 + 100_000);
  });

  it('negative tip floors at 0', () => {
    const r = computeBookingPricing(input({ services: [svc(10)], tipAmountCents: -500 }));
    expect(r.tipCents).toBe(0);
    expect(r.chargeCents).toBe(1000);
  });

  it('null/undefined tip is treated as 0', () => {
    const r = computeBookingPricing(input({ services: [svc(10)], tipAmountCents: null }));
    expect(r.tipCents).toBe(0);
    expect(r.chargeCents).toBe(1000);
  });

  it('mode none → chargeCents 0 even with a tip (matches the verify side `: 0` branch)', () => {
    const r = computeBookingPricing(
      input({ paymentMode: 'none', services: [svc(50)], tipAmountCents: 5000 }),
    );
    expect(r.chargeCents).toBe(0);
  });

  it('float-sensitive: three services at 19.99 + 15% promo → exact cents (sum-then-round)', () => {
    const r = computeBookingPricing(
      input({
        services: [svc(19.99), svc(19.99), svc(19.99)],
        promo: { type: 'percent', value: 15 },
      }),
    );
    // subtotal 59.97 → discount 8.9955 → total 50.9745 → round(5097.45) = 5097
    expect(r.discountDollars).toBeCloseTo(8.9955, 4);
    expect(r.totalDollars).toBeCloseTo(50.9745, 4);
    expect(r.chargeCents).toBe(5097);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PARITY characterizations.
//
// These copy the ORIGINAL inline formulas from
// `app/[locale]/book/[shopSlug]/actions.ts` (mint side =
// `createBookingPaymentIntent`, verify side = `bookPublicAppointment`) as
// LOCAL reference implementations, then assert `computeBookingPricing`
// reproduces them byte-for-byte. This is the proof the extraction is
// faithful; if one of these ever fails after a refactor, the engine drifted
// from a call site (or the call sites drifted from each other) — a booking
// outage caught as a red test instead of in production.
// ─────────────────────────────────────────────────────────────────────────

/** Verbatim copy of the MINT 'full' branch arithmetic (actions.ts
 *  createBookingPaymentIntent: subtotalDollars / discountDollars /
 *  totalDollars / loyalty cap / Math.round(totalDollars*100) + tip). */
function mintFullReference(
  svcs: BookingPricingService[],
  promo: { type: 'percent' | 'fixed'; value: number } | null,
  loyaltyBalanceCents: number,
  tip: number | null | undefined,
): number {
  const subtotalDollars = svcs.reduce((sum, s) => sum + Number(s.price ?? 0), 0);
  let discountDollars = 0;
  if (promo) {
    const raw = promo.type === 'percent' ? (subtotalDollars * promo.value) / 100 : promo.value;
    discountDollars = Math.min(raw, subtotalDollars);
  }
  let totalDollars = subtotalDollars - discountDollars;
  if (loyaltyBalanceCents > 0 && totalDollars > 0) {
    const runningCents = Math.round(totalDollars * 100);
    const creditCents = Math.min(loyaltyBalanceCents, runningCents);
    totalDollars = Math.max(0, totalDollars - creditCents / 100);
  }
  let depositCents = Math.round(totalDollars * 100);
  const tipCents = Math.max(0, Math.min(100_000, tip ?? 0));
  depositCents += tipCents;
  return depositCents;
}

/** Verbatim copy of the VERIFY 'full' arithmetic (actions.ts
 *  bookPublicAppointment: subtotal / discountAmount / totalAmount / loyalty /
 *  recomputedDepositCents). Returns the four downstream values the action
 *  consumes. */
function verifyFullReference(
  services: BookingPricingService[],
  promo: { type: 'percent' | 'fixed'; value: number } | null,
  clientLoyaltyBalanceCents: number,
  tip: number | null | undefined,
  hasPaymentIntent: boolean,
): {
  totalAmount: number;
  loyaltyCreditCents: number;
  discountAmount: number;
  recomputedDepositCents: number;
} {
  const subtotal = services.reduce((sum, s) => sum + s.price, 0);
  let discountAmount = 0;
  if (promo) {
    if (promo.type === 'percent') {
      discountAmount = (subtotal * promo.value) / 100;
    } else {
      discountAmount = promo.value;
    }
    if (discountAmount > subtotal) discountAmount = subtotal;
  }
  let totalAmount = subtotal - discountAmount;
  let loyaltyCreditCents = 0;
  if (clientLoyaltyBalanceCents > 0 && totalAmount > 0) {
    const runningCents = Math.round(totalAmount * 100);
    loyaltyCreditCents = Math.min(clientLoyaltyBalanceCents, runningCents);
    totalAmount = Math.max(0, totalAmount - loyaltyCreditCents / 100);
  }
  const tipCentsForVerify = Math.max(0, Math.min(100_000, tip ?? 0));
  const recomputedDepositCents = hasPaymentIntent
    ? Math.round(totalAmount * 100) + tipCentsForVerify
    : 0;
  return { totalAmount, loyaltyCreditCents, discountAmount, recomputedDepositCents };
}

/** Verbatim copy of the DEPOSIT branch (both sides identical):
 *  Σ deposit_amount_cents + clamped tip. */
function depositReference(
  services: BookingPricingService[],
  tip: number | null | undefined,
): number {
  let depositCents = services.reduce((sum, s) => sum + Number(s.deposit_amount_cents ?? 0), 0);
  const tipCents = Math.max(0, Math.min(100_000, tip ?? 0));
  depositCents += tipCents;
  return depositCents;
}

describe('computeBookingPricing — PARITY with the old inline formulas', () => {
  it('parity #1 — mint full: 3×19.99 + 15% promo + tip matches the mint reference', () => {
    const svcs = [svc(19.99), svc(19.99), svc(19.99)];
    const promo = { type: 'percent' as const, value: 15 };
    const tip = 250;
    const r = computeBookingPricing(
      input({ services: svcs, promo, loyaltyBalanceCents: 0, tipAmountCents: tip }),
    );
    expect(r.chargeCents).toBe(mintFullReference(svcs, promo, 0, tip));
  });

  it('parity #2 — verify full: same inputs reproduce total_amount, credit, discount, recomputed PI', () => {
    const svcs = [svc(34.79), svc(43.49)];
    const promo = { type: 'percent' as const, value: 20 };
    const loyalty = 1500;
    const tip = 500;
    const r = computeBookingPricing(
      input({ services: svcs, promo, loyaltyBalanceCents: loyalty, tipAmountCents: tip }),
    );
    const ref = verifyFullReference(svcs, promo, loyalty, tip, true);
    expect(r.totalDollars).toBe(ref.totalAmount);
    expect(r.loyaltyCreditCents).toBe(ref.loyaltyCreditCents);
    expect(r.discountDollars).toBe(ref.discountAmount);
    expect(r.chargeCents).toBe(ref.recomputedDepositCents);
  });

  it('parity #3 — deposit branch: Σ deposit cents + tip matches the deposit reference', () => {
    const svcs = [svc(100, 1000), svc(80, 2000), svc(50, null)];
    const tip = 750;
    const r = computeBookingPricing(
      input({ paymentMode: 'deposit', services: svcs, tipAmountCents: tip }),
    );
    expect(r.chargeCents).toBe(depositReference(svcs, tip));
  });

  it('parity #4 — mint full: loyalty LARGER than total floors identically', () => {
    const svcs = [svc(20)];
    const loyalty = 5000;
    const r = computeBookingPricing(
      input({ services: svcs, loyaltyBalanceCents: loyalty, tipAmountCents: 0 }),
    );
    expect(r.chargeCents).toBe(mintFullReference(svcs, null, loyalty, 0));
  });

  it('parity #5 — verify full: promo + loyalty stacking reproduces the verify reference exactly', () => {
    const svcs = [svc(100)];
    const promo = { type: 'percent' as const, value: 50 };
    const loyalty = 3000;
    const tip = 100;
    const r = computeBookingPricing(
      input({ services: svcs, promo, loyaltyBalanceCents: loyalty, tipAmountCents: tip }),
    );
    const ref = verifyFullReference(svcs, promo, loyalty, tip, true);
    expect(r.totalDollars).toBe(ref.totalAmount);
    expect(r.loyaltyCreditCents).toBe(ref.loyaltyCreditCents);
    expect(r.discountDollars).toBe(ref.discountAmount);
    expect(r.chargeCents).toBe(ref.recomputedDepositCents);
  });
});
