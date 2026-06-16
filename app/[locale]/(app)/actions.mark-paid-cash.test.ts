import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type Fixtures } from '@/lib/test/supabase-mock';

/**
 * POS-lite stage 2 — `markPaidCash` (record a counter CASH sale). Exercises the
 * `withAction` wrapper for real; the auth seam is mocked (with-action.test.ts
 * idiom) to fabricate ctx, the DB seam goes through the fixture harness, and
 * the audit seam is spied. The same module-load mocks as the cancel-refund
 * suite so importing './actions' resolves with zero network / env.
 */

const h = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getShopMemberships: vi.fn(),
  getCurrentShopId: vi.fn(),
  getCurrentBarberId: vi.fn(),
  captureException: vi.fn(),
  refundPaymentIntentFull: vi.fn(),
  markRefundedByIntent: vi.fn(),
  createDepositPaymentIntent: vi.fn(),
  logAuditAction: vi.fn(),
  logDurableAudit: vi.fn(),
  checkRateLimit: vi.fn(),
  deleteAppointmentMirror: vi.fn(),
  pushAppointment: vi.fn(),
  notifyWaitlist: vi.fn(),
  sendEmail: vi.fn(),
  revalidatePath: vi.fn(),
  sbClient: { current: null as unknown },
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentUser: () => h.getCurrentUser(),
  getShopMemberships: () => h.getShopMemberships(),
  getCurrentShopId: () => h.getCurrentShopId(),
  getCurrentBarberId: () => h.getCurrentBarberId(),
}));
vi.mock('@/lib/observability', () => ({
  captureException: (...a: unknown[]) => h.captureException(...a),
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: () => h.sbClient.current }));
vi.mock('@/lib/stripe/server', () => ({ stripeConfigured: () => true }));
vi.mock('@/lib/stripe/payments', () => ({
  refundPaymentIntentFull: (...a: unknown[]) => h.refundPaymentIntentFull(...a),
  markRefundedByIntent: (...a: unknown[]) => h.markRefundedByIntent(...a),
  createDepositPaymentIntent: (...a: unknown[]) => h.createDepositPaymentIntent(...a),
}));
vi.mock('@/lib/audit-log', () => ({
  logAuditAction: (...a: unknown[]) => h.logAuditAction(...a),
  logDurableAudit: (...a: unknown[]) => h.logDurableAudit(...a),
}));
vi.mock('@/lib/auth/rate-limit', () => ({
  checkRateLimit: (...a: unknown[]) => h.checkRateLimit(...a),
}));
vi.mock('@/lib/google/sync', () => ({
  deleteAppointmentMirror: (...a: unknown[]) => h.deleteAppointmentMirror(...a),
  pushAppointment: (...a: unknown[]) => h.pushAppointment(...a),
}));
vi.mock('@/lib/business/waitlist-notify', () => ({
  notifyMatchingWaitlistOnCancel: (...a: unknown[]) => h.notifyWaitlist(...a),
}));
vi.mock('@/lib/email/send', () => ({ sendEmail: (...a: unknown[]) => h.sendEmail(...a) }));
vi.mock('@/lib/email/templates/appointment-cancellation', () => ({
  AppointmentCancellation: () => null,
}));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => h.revalidatePath(...a) }));

import { markPaidCash } from './actions';

const APPT_ID = '44444444-4444-4444-8444-444444444444';
const SHOP_A = 'shop-a';

function asManager() {
  h.getCurrentUser.mockResolvedValue({ id: 'user-mgr' });
  h.getShopMemberships.mockResolvedValue([
    { shop_id: SHOP_A, role: 'manager', status: 'confirmed' },
  ]);
  h.getCurrentShopId.mockResolvedValue(SHOP_A);
  h.getCurrentBarberId.mockResolvedValue(null);
}
function asBarber(barberId: string) {
  h.getCurrentUser.mockResolvedValue({ id: 'user-barber' });
  h.getShopMemberships.mockResolvedValue([
    { shop_id: SHOP_A, role: 'barber', status: 'confirmed' },
  ]);
  h.getCurrentShopId.mockResolvedValue(SHOP_A);
  h.getCurrentBarberId.mockResolvedValue(barberId);
}

function apptRow(over: Record<string, unknown> = {}) {
  return {
    id: APPT_ID,
    barber_id: 'barber-1',
    shop_id: SHOP_A,
    payment_intent_id: null,
    payment_status: 'unpaid',
    payment_method: null,
    total_amount: 42,
    ...over,
  };
}

function fixtures(over: Partial<Fixtures> = {}): Fixtures {
  return { appointments: [apptRow()], ...over };
}

function setup(fx: Fixtures) {
  const mock = createSupabaseMock(fx);
  h.sbClient.current = mock.client;
  return mock;
}

function paymentUpdate(mock: ReturnType<typeof createSupabaseMock>) {
  return mock.calls.find((c) => c.table === 'appointments' && c.op === 'update');
}

beforeEach(() => {
  vi.clearAllMocks();
  h.logDurableAudit.mockResolvedValue(undefined);
  h.sbClient.current = null;
});

describe('markPaidCash — happy path', () => {
  it('unpaid → paid + cash, writes the durable audit', async () => {
    asManager();
    const mock = setup(fixtures());

    const res = await markPaidCash({ id: APPT_ID });

    expect(res).toMatchObject({ ok: true, data: { id: APPT_ID } });
    const upd = paymentUpdate(mock);
    expect(upd?.payload).toMatchObject({ payment_status: 'paid', payment_method: 'cash' });
    // Persisted row reflects the sale.
    expect(mock.tables.appointments![0]!).toMatchObject({
      payment_status: 'paid',
      payment_method: 'cash',
    });
    expect(h.logDurableAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'custom',
        entity: 'appointments',
        entityId: APPT_ID,
        diff: { marked_paid_cash: true, amount: 42 },
      }),
    );
  });

  it('invariant §1.1 — writes NO payment_intent_id and never "pending"', async () => {
    asManager();
    const mock = setup(fixtures());

    await markPaidCash({ id: APPT_ID });

    const upd = paymentUpdate(mock);
    const payload = upd?.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty('payment_intent_id');
    expect(payload.payment_status).toBe('paid');
    expect(payload.payment_status).not.toBe('pending');
    // The row's PI link stays null — Stripe reconcile/webhook can never match it.
    expect(mock.tables.appointments![0]!.payment_intent_id).toBeNull();
  });
});

describe('markPaidCash — idempotency', () => {
  it('already-paid row → CONFLICT already_paid, no write, no audit', async () => {
    asManager();
    const mock = setup(fixtures({ appointments: [apptRow({ payment_status: 'paid' })] }));

    const res = await markPaidCash({ id: APPT_ID });

    expect(res).toMatchObject({
      ok: false,
      errorCode: 'CONFLICT',
      fieldErrors: { payment: 'already_paid' },
    });
    expect(paymentUpdate(mock)).toBeUndefined();
    expect(h.logDurableAudit).not.toHaveBeenCalled();
  });

  it('a second call does not double-record (one update, one audit)', async () => {
    asManager();
    const mock = setup(fixtures());

    const first = await markPaidCash({ id: APPT_ID });
    const second = await markPaidCash({ id: APPT_ID });

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({
      ok: false,
      errorCode: 'CONFLICT',
      fieldErrors: { payment: 'already_paid' },
    });
    const updates = mock.calls.filter((c) => c.table === 'appointments' && c.op === 'update');
    expect(updates).toHaveLength(1);
    expect(h.logDurableAudit).toHaveBeenCalledTimes(1);
  });
});

describe('markPaidCash — tenant + barber-own gates', () => {
  it('cross-shop: a shop-B row under shop-A ctx → NOT_FOUND', async () => {
    asManager();
    const mock = setup(fixtures({ appointments: [apptRow({ shop_id: 'shop-b' })] }));

    const res = await markPaidCash({ id: APPT_ID });

    expect(res).toMatchObject({ ok: false, errorCode: 'NOT_FOUND' });
    expect(paymentUpdate(mock)).toBeUndefined();
  });

  it('barber may close their OWN appointment', async () => {
    asBarber('barber-1');
    const mock = setup(fixtures());

    const res = await markPaidCash({ id: APPT_ID });

    expect(res.ok).toBe(true);
    expect(paymentUpdate(mock)?.payload).toMatchObject({ payment_method: 'cash' });
  });

  it('barber may NOT close ANOTHER barber’s appointment → FORBIDDEN', async () => {
    asBarber('barber-2'); // ctx barber differs from appt.barber_id
    const mock = setup(fixtures({ appointments: [apptRow({ barber_id: 'barber-1' })] }));

    const res = await markPaidCash({ id: APPT_ID });

    expect(res).toMatchObject({ ok: false, errorCode: 'FORBIDDEN' });
    expect(paymentUpdate(mock)).toBeUndefined();
    expect(h.logDurableAudit).not.toHaveBeenCalled();
  });
});
