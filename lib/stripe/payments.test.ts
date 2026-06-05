import { describe, expect, it, vi } from 'vitest';
import { markRefundedByIntent } from './payments';

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
