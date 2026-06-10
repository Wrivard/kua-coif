import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { mapIntentStatus, markRefundedByIntent, refundOwnedIntentBestEffort } from './payments';

// Shared fake Stripe client — both refundOwnedIntentBestEffort and the
// refundPaymentIntent it delegates to resolve their client via getStripe().
// `vi.hoisted` so the spies exist before the hoisted vi.mock factory runs.
const { retrieve, refundsCreate } = vi.hoisted(() => ({
  retrieve: vi.fn(),
  refundsCreate: vi.fn(),
}));
vi.mock('./server', () => ({
  getStripe: () => ({
    paymentIntents: { retrieve },
    refunds: { create: refundsCreate },
  }),
}));

describe('markRefundedByIntent', () => {
  it('updates appointments.payment_status to refunded by PaymentIntent id', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    const sb = { from };

    await markRefundedByIntent(sb, 'pi_123');

    expect(from).toHaveBeenCalledWith('appointments');
    expect(update).toHaveBeenCalledWith({ payment_status: 'refunded' });
    expect(eq).toHaveBeenCalledWith('payment_intent_id', 'pi_123');
  });
});

describe('refundOwnedIntentBestEffort', () => {
  // The safety net for the public booking money path (plan 001): refund the
  // charged PI when a booking fails post-charge, but ONLY when the PI provably
  // belongs to this shop and actually captured money.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT refund a PI destined to another shop (wrong_shop)', async () => {
    // A crafted POST that forces the failure path must not be able to refund
    // someone else's charge.
    retrieve.mockResolvedValue({
      id: 'pi_other',
      amount: 5000,
      status: 'succeeded',
      transfer_data: { destination: 'acct_OTHER' },
    });

    const res = await refundOwnedIntentBestEffort({
      paymentIntentId: 'pi_other',
      expectedConnectedAccountId: 'acct_THIS',
    });

    expect(res).toEqual({ refunded: false, reason: 'wrong_shop' });
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it('does NOT refund a PI that never captured money (not_charged)', async () => {
    retrieve.mockResolvedValue({
      id: 'pi_pending',
      amount: 5000,
      status: 'requires_payment_method',
      transfer_data: { destination: 'acct_THIS' },
    });

    const res = await refundOwnedIntentBestEffort({
      paymentIntentId: 'pi_pending',
      expectedConnectedAccountId: 'acct_THIS',
    });

    expect(res).toEqual({ refunded: false, reason: 'not_charged' });
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it('refunds the captured amount for an owned, succeeded PI', async () => {
    retrieve.mockResolvedValue({
      id: 'pi_ok',
      amount: 4200,
      status: 'succeeded',
      transfer_data: { destination: 'acct_THIS' },
    });
    refundsCreate.mockResolvedValue({ id: 're_1' });

    const res = await refundOwnedIntentBestEffort({
      paymentIntentId: 'pi_ok',
      expectedConnectedAccountId: 'acct_THIS',
    });

    expect(res).toEqual({ refunded: true });
    // Refunds the PI's own amount with the deterministic idempotency key.
    expect(refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_ok', amount: 4200 }),
      expect.objectContaining({ idempotencyKey: 'refund-pi_ok-4200' }),
    );
  });
});

describe('mapIntentStatus', () => {
  // Pure mapping from Stripe PaymentIntent status → our payment_status enum.
  // No Stripe client involved, so this is the testable core of the refund /
  // payment-status semantics.

  it('maps succeeded → paid', () => {
    expect(mapIntentStatus('succeeded')).toBe('paid');
  });

  it('maps canceled → failed (treated as a terminal failure, not pending)', () => {
    expect(mapIntentStatus('canceled')).toBe('failed');
  });

  it('maps every pre-settlement / in-flight status → pending', () => {
    const pendingStates: Stripe.PaymentIntent.Status[] = [
      'processing',
      'requires_payment_method',
      'requires_confirmation',
      'requires_action',
      'requires_capture',
    ];
    for (const status of pendingStates) {
      expect(mapIntentStatus(status), `expected ${status} → pending`).toBe('pending');
    }
  });

  it('defensively maps an unknown status → pending', () => {
    // Future Stripe statuses (or a malformed value) must never be silently
    // treated as paid/refunded — the safe default is pending.
    expect(mapIntentStatus('something_new' as Stripe.PaymentIntent.Status)).toBe('pending');
  });
});
