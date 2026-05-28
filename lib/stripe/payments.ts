/**
 * Stripe Payments — Phase 38.
 *
 * Creates PaymentIntents on connected shop accounts (Stripe Connect
 * Express, Phase 28). The intent is created in the platform account and
 * uses the `on_behalf_of` / `transfer_data.destination` model so:
 *   - The platform (Küa) appears as the merchant of record
 *   - Funds settle to the shop's connected account
 *   - We can later add an application_fee_amount for revenue share
 *
 * This file does NOT include the UI side. The Stripe Elements integration
 * (card collection, confirm flow) lives in the booking wizard and the
 * appointment detail drawer — both V1.1 work. What's here is the
 * backend infrastructure those UIs will call.
 *
 * Webhook handler (in `/api/webhooks/stripe/route.ts`) listens for
 * `payment_intent.succeeded`, `payment_intent.payment_failed`, and
 * `charge.refunded` to keep `appointments.payment_status` in sync.
 */

import type Stripe from 'stripe';
import { getStripe } from './server';
import { applicationFeeForAmount, getPlatformAppFeeBps } from './platform-config';

/**
 * Create a PaymentIntent for a deposit on an appointment.
 *
 * Returns the client_secret which the front-end uses to confirm the
 * payment with Stripe Elements. The intent is in `requires_payment_method`
 * state until the card is supplied and confirmed client-side.
 *
 * `connectedAccountId`: the shop's `stripe_account_id` (from
 * `shops.stripe_account_id`). Required — without a connected account
 * we can't route funds to the right shop.
 *
 * `applicationFeeCents` (optional): platform fee in cents. V1 leaves
 * it at 0; future paid tier could route e.g. 5% to Küa.
 *
 * Idempotency key based on appointment ID prevents duplicate intents
 * if the caller retries (e.g., network blip during booking).
 */
export async function createDepositPaymentIntent({
  connectedAccountId,
  appointmentId,
  amountCents,
  currency = 'cad',
  customerEmail,
  applicationFeeCents,
}: {
  connectedAccountId: string;
  appointmentId: string;
  amountCents: number;
  currency?: string;
  customerEmail?: string;
  applicationFeeCents?: number;
}): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();
  // Caller can override (per-shop pricing tiers if we ever add them).
  // Otherwise read from platform_config.app_fee_bps.
  const fee =
    applicationFeeCents ?? applicationFeeForAmount(amountCents, await getPlatformAppFeeBps());
  return stripe.paymentIntents.create(
    {
      amount: amountCents,
      currency,
      // Destination charge: platform takes the charge, then transfers
      // (amount - application_fee) to the connected account. Funds
      // settle on the shop's payout schedule.
      transfer_data: { destination: connectedAccountId },
      application_fee_amount: fee > 0 ? fee : undefined,
      // Allow card (default) only. Future could add `apple_pay`,
      // `google_pay`, etc. via Payment Element.
      automatic_payment_methods: { enabled: true },
      receipt_email: customerEmail,
      metadata: {
        appointment_id: appointmentId,
        kua_kind: 'appointment_deposit',
      },
      description: `Deposit for appointment ${appointmentId}`,
    },
    {
      // Replay-safe — Stripe returns the same intent for the same key.
      idempotencyKey: `appt-deposit-${appointmentId}`,
    },
  );
}

/**
 * Phase A SR — retrieve an existing PaymentIntent for the booking wizard
 * to reuse across re-renders when the amount hasn't actually changed.
 *
 * Phase A SR-of-SR security note: the original Phase A SR also mutated
 * the PI's `amount` via `paymentIntents.update` when the customer
 * changed their service selection. That introduced a client/server
 * amount-of-record race: Stripe Elements caches the amount from
 * `clientSecret` at mount time, so a customer who clicked Confirm
 * BEFORE the client re-rendered with the new amount would see "$50"
 * in the UI and get charged "$40" (or "$40" UI → "$50" charge — the
 * dangerous direction).
 *
 * The right model is: when amount changes, throw the old PI away and
 * mint a new one. The new PI has a fresh `clientSecret` → Stripe
 * Elements re-mounts → the customer always sees the amount they're
 * actually authorizing. We keep the reuse path ONLY for the no-op
 * case (same amount + same fee), which is the common one for cosmetic
 * re-renders (parent state change, theme toggle, etc.).
 *
 * Returns null when:
 *   - the PI doesn't exist (deleted, wrong ID)
 *   - the PI belongs to a different connected account
 *   - the PI is no longer in a pre-confirmation state
 *   - amount or fee has changed (caller falls back to create)
 */
export async function getReusableDepositPaymentIntent({
  paymentIntentId,
  connectedAccountId,
  amountCents,
  applicationFeeCents,
}: {
  paymentIntentId: string;
  connectedAccountId: string;
  amountCents: number;
  applicationFeeCents?: number;
}): Promise<Stripe.PaymentIntent | null> {
  const stripe = getStripe();
  let existing: Stripe.PaymentIntent;
  try {
    existing = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch {
    return null;
  }

  // Same-shop guard.
  const dest =
    typeof existing.transfer_data?.destination === 'string'
      ? existing.transfer_data.destination
      : (existing.transfer_data?.destination?.id ?? null);
  if (dest !== connectedAccountId) return null;

  // Pre-confirmation state guard. `requires_payment_method` (no card
  // yet) and `requires_confirmation` (card attached but not confirmed)
  // are the only states where a fresh card-entry session against the
  // same clientSecret still makes sense.
  if (
    existing.status !== 'requires_payment_method' &&
    existing.status !== 'requires_confirmation'
  ) {
    return null;
  }

  // Amount + fee must match exactly — any divergence means the client's
  // Elements would be displaying a stale amount. New PI = new
  // clientSecret = Elements re-mounts with the authoritative value.
  //
  // Phase F — pulls the BPS from platform_config (with env-var
  // fallback). A super-admin save invalidates the cache so a fee
  // change forces a fresh mint on the next reuse attempt.
  const fee =
    applicationFeeCents ?? applicationFeeForAmount(amountCents, await getPlatformAppFeeBps());
  if (existing.amount !== amountCents || (existing.application_fee_amount ?? 0) !== fee) {
    return null;
  }

  return existing;
}

/**
 * Refund a paid appointment. Callers always pass an explicit
 * `amountCents` so the idempotency key is fully deterministic; the
 * convenience case ("full refund of the PI") is handled by
 * `refundPaymentIntentFull` below, which fetches the PI's `amount`
 * and forwards.
 *
 * Loop 31 (P95 from AUDIT_PHASE70) — the previous signature accepted
 * `amountCents?: number` and embedded `amountCents ?? 'full'` in the
 * idempotency key. That meant:
 *   - call A: `{ paymentIntentId: pi_xxx }`           → key `refund-pi_xxx-full`
 *   - call B: `{ paymentIntentId: pi_xxx, amountCents: 2500 }` → key `refund-pi_xxx-2500`
 * Stripe treats these as two distinct requests even though both
 * refund the full $25. Result: double refund. Forcing explicit cents
 * collapses the surface to a single deterministic key per refund.
 *
 * Stripe surfaces refund failures via `charge.refunded` (success) and
 * `charge.refund.updated` (failure) webhooks.
 */
export async function refundPaymentIntent({
  paymentIntentId,
  amountCents,
}: {
  paymentIntentId: string;
  amountCents: number;
}): Promise<Stripe.Refund> {
  const stripe = getStripe();
  return stripe.refunds.create(
    {
      payment_intent: paymentIntentId,
      amount: amountCents,
      // Reverses any application fee proportionally — saves the shop the
      // 5% they didn't actually earn (or whatever the fee was).
      reverse_transfer: true,
      refund_application_fee: true,
    },
    {
      idempotencyKey: `refund-${paymentIntentId}-${amountCents}`,
    },
  );
}

/**
 * Convenience wrapper — fetches the PaymentIntent to read its
 * `amount`, then issues a full refund with that explicit value. All
 * three of our refund call-sites (cancelAppointment, bulkCancel,
 * refundAppointment) want a full refund; routing them through this
 * helper keeps the idempotency key deterministic regardless of who
 * triggered the refund.
 */
export async function refundPaymentIntentFull({
  paymentIntentId,
}: {
  paymentIntentId: string;
}): Promise<Stripe.Refund> {
  const stripe = getStripe();
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  return refundPaymentIntent({ paymentIntentId, amountCents: intent.amount });
}

/**
 * Phase A (Stripe hardening) — server-side PaymentIntent verification.
 *
 * The booking action receives `payment_intent_id` from the client and
 * persists it on the appointment row. Without this verify call, a
 * hand-crafted POST could attach ANY `pi_*` (their own from a previous
 * shop, a fabricated string, a partially-confirmed intent with $0
 * amount) — and the row would happily claim the appointment was paid.
 *
 * The check has three legs:
 *   1. The PI exists (no NOT_FOUND from Stripe).
 *   2. Its destination matches the shop's connected account — guards
 *      against PIs from other shops being attached here.
 *   3. Its amount matches what we expect for the selected services'
 *      deposits — guards against using a $1 PI from another booking
 *      to fake a $50 deposit on this one.
 *   4. Its status is `succeeded` or `processing` — anything earlier
 *      (`requires_payment_method`, etc.) means the customer never
 *      actually entered/confirmed card details.
 *
 * Returns the canonical status so the caller can also fix the webhook
 * race in one shot: if Stripe says `succeeded` at this moment, we can
 * write `payment_status='paid'` at insert time and not wait for a
 * webhook that may have already fired (and no-op'd because the row
 * didn't exist yet).
 */
export type VerifyDepositPiResult =
  | { valid: true; status: Stripe.PaymentIntent.Status }
  | {
      valid: false;
      reason: 'not_found' | 'wrong_shop' | 'wrong_amount' | 'wrong_status' | 'wrong_currency';
    };

export async function verifyDepositPaymentIntent({
  paymentIntentId,
  expectedConnectedAccountId,
  expectedAmountCents,
}: {
  paymentIntentId: string;
  expectedConnectedAccountId: string;
  expectedAmountCents: number;
}): Promise<VerifyDepositPiResult> {
  const stripe = getStripe();
  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch {
    return { valid: false, reason: 'not_found' };
  }

  // Destination check — `transfer_data.destination` can be a string ID
  // or an expanded Account object depending on retrieve options.
  // We don't expand, so the typed-string path is what runs in practice;
  // the object-id fallback is belt-and-suspenders for future changes.
  const dest =
    typeof intent.transfer_data?.destination === 'string'
      ? intent.transfer_data.destination
      : (intent.transfer_data?.destination?.id ?? null);
  if (dest !== expectedConnectedAccountId) {
    return { valid: false, reason: 'wrong_shop' };
  }

  // Phase A SR-of-SR — CAD-only by design today (`createDepositPaymentIntent`
  // hardcodes 'cad', `formatCurrencyCAD` is the only money formatter in the
  // wizard). Defense-in-depth: reject any PI in a different currency so a
  // future multi-currency feature can't silently break the deposit
  // verification with the same numeric `amount`.
  if (intent.currency !== 'cad') {
    return { valid: false, reason: 'wrong_currency' };
  }

  if (intent.amount !== expectedAmountCents) {
    return { valid: false, reason: 'wrong_amount' };
  }

  if (intent.status !== 'succeeded' && intent.status !== 'processing') {
    return { valid: false, reason: 'wrong_status' };
  }

  return { valid: true, status: intent.status };
}

/**
 * Translate a Stripe PaymentIntent status into our enum.
 *
 * Mapping:
 *   - succeeded                          → 'paid'
 *   - processing                         → 'pending'
 *   - requires_payment_method / action   → 'pending' (user not done yet)
 *   - canceled                           → 'failed' (treat as failed)
 *   - anything else                      → 'pending' (defensive)
 */
export function mapIntentStatus(
  status: Stripe.PaymentIntent.Status,
): 'unpaid' | 'pending' | 'paid' | 'refunded' | 'failed' {
  switch (status) {
    case 'succeeded':
      return 'paid';
    case 'canceled':
      return 'failed';
    case 'processing':
    case 'requires_payment_method':
    case 'requires_confirmation':
    case 'requires_action':
    case 'requires_capture':
      return 'pending';
    default:
      return 'pending';
  }
}
