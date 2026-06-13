// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { NextRequest } from 'next/server';
import { createSupabaseMock, type Fixtures } from '@/lib/test/supabase-mock';

/**
 * Flow tests for the Stripe webhook receiver. Signatures are minted OFFLINE
 * with the real Stripe SDK (`generateTestHeaderString`) so `constructEvent`
 * runs for real — no network. The supabase + side-effect seams are mocked and
 * asserted via the fixture harness + spies. Runs under the node environment
 * (NextRequest + node crypto) per the vitest-environment pragma above.
 */

const SECRET = 'whsec_test_secret';

const h = vi.hoisted(() => ({
  chargesRetrieve: vi.fn(),
  markRefundedByIntent: vi.fn(),
  sendSlackDispute: vi.fn(),
  captureException: vi.fn(),
  srClient: { current: null as unknown },
}));

vi.mock('@/lib/supabase/service-role', () => ({
  createSupabaseServiceRoleClient: () => h.srClient.current,
}));
vi.mock('@/lib/stripe/server', async () => {
  const StripeMod = (await import('stripe')).default;
  const real = new StripeMod('sk_test_dummy');
  return {
    stripeConfigured: () => true,
    getStripe: () => ({ webhooks: real.webhooks, charges: { retrieve: h.chargesRetrieve } }),
  };
});
vi.mock('@/lib/stripe/payments', async (orig) => ({
  ...(await orig<typeof import('@/lib/stripe/payments')>()),
  markRefundedByIntent: (...a: unknown[]) => h.markRefundedByIntent(...a),
}));
vi.mock('@/lib/notifications/slack', () => ({
  sendSlackDisputeNotification: (...a: unknown[]) => h.sendSlackDispute(...a),
}));
vi.mock('@/lib/observability', () => ({
  captureException: (...a: unknown[]) => h.captureException(...a),
}));

import { POST } from './route';

const sigStripe = new Stripe('sk_test_dummy');

function signedRequest(event: Record<string, unknown>, secret = SECRET): NextRequest {
  const payload = JSON.stringify(event);
  const signature = sigStripe.webhooks.generateTestHeaderString({ payload, secret });
  return new NextRequest('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    body: payload,
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
  });
}

function setup(fixtures: Fixtures = {}, errors?: Parameters<typeof createSupabaseMock>[1]) {
  const mock = createSupabaseMock(fixtures, errors);
  h.srClient.current = mock.client;
  return mock;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  h.srClient.current = null;
});

describe('stripe webhook POST', () => {
  it('payment_intent.succeeded → updates the matching appointment to paid by intent id', async () => {
    const mock = setup({
      stripe_events: [],
      appointments: [{ id: 'a1', payment_intent_id: 'pi_1', payment_status: 'pending' }],
    });

    const res = await POST(
      signedRequest({
        id: 'evt_1',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_1',
            status: 'succeeded',
            amount: 3000,
            transfer_data: { destination: 'acct_1' },
          },
        },
      }),
    );

    expect(res.status).toBe(200);
    const update = mock.calls.find((c) => c.table === 'appointments' && c.op === 'update');
    expect(update?.payload).toEqual({ payment_status: 'paid' });
    expect(update?.filters).toContainEqual(['payment_intent_id', 'pi_1']);
    expect(mock.tables.appointments![0]!.payment_status).toBe('paid');
  });

  it('duplicate event already COMPLETED (23505 + processed_at set) → handler skipped, no appointments write', async () => {
    const mock = setup(
      {
        stripe_events: [
          {
            id: 'evt_dup',
            event_type: 'payment_intent.succeeded',
            processed_at: '2026-06-13T00:00:00.000Z',
          },
        ],
        appointments: [{ id: 'a1', payment_intent_id: 'pi_1', payment_status: 'pending' }],
      },
      { errors: { stripe_events: { insert: { code: '23505', message: 'dup' } } } },
    );

    const res = await POST(
      signedRequest({
        id: 'evt_dup',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_1', status: 'succeeded', amount: 3000 } },
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; skipped?: string };
    expect(body).toMatchObject({ ok: true, skipped: 'already_processed' });
    expect(mock.calls.some((c) => c.table === 'appointments')).toBe(false);
  });

  it('duplicate event NOT yet completed (23505 + processed_at null) → handler re-processes (FIN-BE-02)', async () => {
    // A prior delivery inserted the dedupe lock but its handler failed before
    // completion (processed_at null). Stripe retries → the event MUST be
    // re-processed, not skipped, so the money event is never lost.
    const mock = setup(
      {
        stripe_events: [
          { id: 'evt_retry', event_type: 'payment_intent.succeeded', processed_at: null },
        ],
        appointments: [{ id: 'a1', payment_intent_id: 'pi_1', payment_status: 'pending' }],
      },
      { errors: { stripe_events: { insert: { code: '23505', message: 'dup' } } } },
    );

    const res = await POST(
      signedRequest({
        id: 'evt_retry',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_1', status: 'succeeded', amount: 3000 } },
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; skipped?: string };
    expect(body).toEqual({ ok: true });
    // Handler re-ran → appointment flipped to paid.
    expect(mock.tables.appointments![0]!.payment_status).toBe('paid');
    // And the event was marked processed so the next retry skips it.
    expect(mock.calls.some((c) => c.table === 'stripe_events' && c.op === 'update')).toBe(true);
  });

  it('charge.refund.updated (failed) → flips status back to paid ONLY for rows we marked refunded', async () => {
    const mock = setup({
      stripe_events: [],
      appointments: [{ id: 'a1', payment_intent_id: 'pi_1', payment_status: 'refunded' }],
    });

    const res = await POST(
      signedRequest({
        id: 'evt_refund_failed',
        type: 'charge.refund.updated',
        data: { object: { id: 're_1', payment_intent: 'pi_1', status: 'failed' } },
      }),
    );

    expect(res.status).toBe(200);
    const update = mock.calls.find((c) => c.table === 'appointments' && c.op === 'update');
    expect(update?.payload).toEqual({ payment_status: 'paid' });
    // The guard that prevents clobbering a non-WE-refunded row.
    expect(update?.filters).toContainEqual(['payment_intent_id', 'pi_1']);
    expect(update?.filters).toContainEqual(['payment_status', 'refunded']);
    expect(h.captureException).toHaveBeenCalled();
  });

  it('invalid signature → 400 with zero database calls', async () => {
    const mock = setup({ stripe_events: [] });

    const req = new NextRequest('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      body: JSON.stringify({ id: 'evt_x', type: 'payment_intent.succeeded', data: { object: {} } }),
      headers: { 'stripe-signature': 't=1,v1=deadbeef', 'content-type': 'application/json' },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(mock.calls).toHaveLength(0);
    expect(h.captureException).toHaveBeenCalled();
  });

  it('dispute with no matching shop → orphan logged, no disputes row written', async () => {
    // No appointment matches the intent, and the charge fallback resolves a
    // connected account that maps to no shop → the orphan branch.
    h.chargesRetrieve.mockResolvedValue({ transfer_data: { destination: 'acct_NOPE' } });
    const mock = setup({ stripe_events: [], appointments: [], shops: [] });

    const res = await POST(
      signedRequest({
        id: 'evt_dispute',
        type: 'charge.dispute.created',
        data: {
          object: {
            id: 'dp_1',
            charge: 'ch_1',
            payment_intent: 'pi_unknown',
            amount: 5000,
            currency: 'cad',
            reason: 'fraudulent',
            status: 'warning_needs_response',
            evidence_details: { due_by: 1_700_000_000 },
          },
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(mock.calls.some((c) => c.table === 'disputes')).toBe(false);
    expect(h.sendSlackDispute).not.toHaveBeenCalled();
    expect(h.captureException).toHaveBeenCalled();
  });
});
