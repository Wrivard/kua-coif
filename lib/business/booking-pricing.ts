/**
 * Single source of truth for the public-booking charge formula.
 *
 * The charge amount used to be computed TWICE in
 * `app/[locale]/book/[shopSlug]/actions.ts`:
 *   - `createBookingPaymentIntent` (the MINT side — what Stripe charges), and
 *   - `bookPublicAppointment` (the VERIFY side — what the PI *should* be).
 * Those two hand-maintained copies had to stay byte-identical or the verify
 * rejects a legitimate PaymentIntent with `wrong_amount` — a one-cent
 * divergence is a total public-booking outage. This module collapses both
 * into one pure function so any drift becomes a failing unit test instead of
 * a production outage.
 *
 * IMPORTANT — this is a faithful EXTRACTION, not a rewrite. The math is
 * reproduced exactly, including the float-dollar intermediate
 * representation (`*Dollars`). Migrating the whole pipeline to integer cents
 * is the correct V2 (do it behind the parity tests in
 * `booking-pricing.test.ts`); do NOT "fix" the dollars-float math here.
 *
 * POLICY stays in the callers: promo eligibility (expiry / one-time /
 * first-appointment), loyalty fetching + expiry, and the silent-degrade of
 * an invalid promo to `null` all live in the action. This function only does
 * arithmetic on already-resolved inputs.
 */

/** Per-service pricing inputs. `price` is in DOLLARS (numeric column);
 *  `deposit_amount_cents` is integer cents. Mirrors the `services` rows
 *  selected at both call sites. */
export type BookingPricingService = {
  price: number;
  deposit_amount_cents: number | null;
};

export type BookingPricingInput = {
  paymentMode: 'full' | 'deposit' | 'none';
  services: BookingPricingService[];
  /** RESOLVED promo (caller validates policy/eligibility) or null. */
  promo: { type: 'percent' | 'fixed'; value: number } | null;
  /** Effective (non-expired) loyalty balance in cents; 0 when none. */
  loyaltyBalanceCents: number;
  tipAmountCents: number | null | undefined;
};

export type BookingPricing = {
  subtotalDollars: number;
  discountDollars: number;
  loyaltyCreditCents: number;
  /** Post-promo, post-loyalty service total in dollars (the row's
   *  `total_amount`). */
  totalDollars: number;
  /** Tip clamped to 0..100_000 cents. */
  tipCents: number;
  /** What the PI must charge: per-mode base + tip. 0 when mode === 'none'. */
  chargeCents: number;
};

/** Upper bound on a single tip, in cents ($1,000). Mirrors the historical
 *  `Math.min(100_000, …)` clamp that lived inline at both call sites. */
const MAX_TIP_CENTS = 100_000;

export function computeBookingPricing(input: BookingPricingInput): BookingPricing {
  // 1. Subtotal — sum of service prices in dollars.
  const subtotalDollars = input.services.reduce((sum, s) => sum + Number(s.price ?? 0), 0);

  // 2. Promo discount — percent of subtotal or a fixed dollar amount,
  //    capped at the subtotal so a promo can never drive the bill negative.
  let discountDollars = 0;
  if (input.promo) {
    const raw =
      input.promo.type === 'percent' ? (subtotalDollars * input.promo.value) / 100 : input.promo.value;
    discountDollars = Math.min(raw, subtotalDollars);
  }

  // 3. Post-promo running total.
  let totalDollars = subtotalDollars - discountDollars;

  // 4. Loyalty credit — applied AFTER promo, capped (in cents, to avoid
  //    float drift) at the running total so a generous balance can zero the
  //    bill but never go negative. Only when there's a balance AND something
  //    left to discount.
  let loyaltyCreditCents = 0;
  if (input.loyaltyBalanceCents > 0 && totalDollars > 0) {
    const runningCents = Math.round(totalDollars * 100);
    loyaltyCreditCents = Math.min(input.loyaltyBalanceCents, runningCents);
    totalDollars = Math.max(0, totalDollars - loyaltyCreditCents / 100);
  }

  // 5. Tip clamp — 0..$1,000; a negative client input floors at 0.
  const tipCents = Math.max(0, Math.min(MAX_TIP_CENTS, input.tipAmountCents ?? 0));

  // 6. What the PaymentIntent must charge, per payment mode (tip stacks on
  //    top in both paid modes):
  //    - 'none'    → 0 (no PI on this path).
  //    - 'full'    → the post-discount total, rounded once at the end
  //                  (sum-then-round, matching the verify side).
  //    - 'deposit' → sum of per-service deposit cents; discounts apply to the
  //                  in-shop balance, not the deposit.
  let chargeCents: number;
  if (input.paymentMode === 'none') {
    chargeCents = 0;
  } else if (input.paymentMode === 'full') {
    chargeCents = Math.round(totalDollars * 100) + tipCents;
  } else {
    chargeCents =
      input.services.reduce((sum, s) => sum + Number(s.deposit_amount_cents ?? 0), 0) + tipCents;
  }

  return {
    subtotalDollars,
    discountDollars,
    loyaltyCreditCents,
    totalDollars,
    tipCents,
    chargeCents,
  };
}
