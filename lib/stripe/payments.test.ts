import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { mapIntentStatus, markRefundedByIntent } from './payments';

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
