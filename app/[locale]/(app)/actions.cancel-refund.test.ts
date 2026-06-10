import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type Fixtures } from '@/lib/test/supabase-mock';

/**
 * Role / policy / IDOR matrix for `cancelAppointment` (+ its refund leg) — the
 * admin-side money path. The `withAction` wrapper is exercised for real; the
 * auth seam is mocked (the with-action.test.ts idiom) to fabricate ctx, and
 * the DB + Stripe + side-effect seams go through the fixture harness + spies.
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

import { cancelAppointment } from './actions';

const APPT_ID = '33333333-3333-4333-8333-333333333333';
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
    google_event_id: null,
    payment_intent_id: null,
    payment_status: 'unpaid',
    start_at: new Date(Date.now() + 100 * 86_400_000).toISOString(), // far future
    status: 'booked',
    shop_id: SHOP_A,
    client_id: null,
    ...over,
  };
}

function fixtures(over: Partial<Fixtures> = {}): Fixtures {
  return {
    appointments: [apptRow()],
    shops: [
      {
        id: SHOP_A,
        name: 'Axum',
        timezone: 'America/Toronto',
        phone: '+1',
        default_language: 'fr',
      },
    ],
    ...over,
  };
}

function setup(fx: Fixtures) {
  const mock = createSupabaseMock(fx);
  h.sbClient.current = mock.client;
  return mock;
}

function statusUpdate(mock: ReturnType<typeof createSupabaseMock>) {
  return mock.calls.find(
    (c) =>
      c.table === 'appointments' &&
      c.op === 'update' &&
      (c.payload as { status?: string })?.status === 'cancelled',
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.checkRateLimit.mockResolvedValue({ allowed: true });
  h.refundPaymentIntentFull.mockResolvedValue({ id: 're_1' });
  h.markRefundedByIntent.mockResolvedValue(undefined);
  h.logAuditAction.mockResolvedValue(undefined);
  h.logDurableAudit.mockResolvedValue(undefined);
  h.notifyWaitlist.mockResolvedValue(undefined);
  h.sendEmail.mockResolvedValue(undefined);
  h.sbClient.current = null;
});

describe('cancelAppointment — role / IDOR gates', () => {
  it('barber cancelling their OWN appointment succeeds (status → cancelled, no refund)', async () => {
    asBarber('barber-1');
    const mock = setup(fixtures());

    const res = await cancelAppointment({ id: APPT_ID });

    expect(res.ok).toBe(true);
    const upd = statusUpdate(mock);
    expect(upd?.filters).toContainEqual(['id', APPT_ID]);
    expect(h.refundPaymentIntentFull).not.toHaveBeenCalled();
  });

  it('barber cancelling SOMEONE ELSE’S appointment → FORBIDDEN not_your_appointment', async () => {
    asBarber('barber-2'); // ctx barber differs from appt.barber_id
    const mock = setup(fixtures());

    const res = await cancelAppointment({ id: APPT_ID });

    expect(res).toMatchObject({
      ok: false,
      errorCode: 'FORBIDDEN',
      fieldErrors: { reason: 'not_your_appointment' },
    });
    expect(statusUpdate(mock)).toBeUndefined();
  });

  it('manager can cancel any appointment', async () => {
    asManager();
    const mock = setup(fixtures({ appointments: [apptRow({ barber_id: 'barber-9' })] }));

    const res = await cancelAppointment({ id: APPT_ID });

    expect(res.ok).toBe(true);
    expect(statusUpdate(mock)).toBeDefined();
  });

  it('cross-tenant: a shop-B row under shop-A ctx → NOT_FOUND', async () => {
    asManager();
    const mock = setup(fixtures({ appointments: [apptRow({ shop_id: 'shop-b' })] }));

    const res = await cancelAppointment({ id: APPT_ID });

    expect(res).toMatchObject({ ok: false, errorCode: 'NOT_FOUND' });
    expect(statusUpdate(mock)).toBeUndefined();
  });

  it('a terminal (completed) appointment cannot be cancelled → terminal_status_locked', async () => {
    asManager();
    const mock = setup(fixtures({ appointments: [apptRow({ status: 'completed' })] }));

    const res = await cancelAppointment({ id: APPT_ID });

    expect(res).toMatchObject({
      ok: false,
      errorCode: 'INVALID_INPUT',
      fieldErrors: { reason: 'terminal_status_locked' },
    });
    expect(statusUpdate(mock)).toBeUndefined();
  });

  it('a barber may NOT move money: own appointment + also_refund → FORBIDDEN refund_requires_manager', async () => {
    asBarber('barber-1');
    const mock = setup(
      fixtures({ appointments: [apptRow({ payment_status: 'paid', payment_intent_id: 'pi_1' })] }),
    );

    const res = await cancelAppointment({ id: APPT_ID, also_refund: true });

    expect(res).toMatchObject({
      ok: false,
      errorCode: 'FORBIDDEN',
      fieldErrors: { reason: 'refund_requires_manager' },
    });
    expect(h.refundPaymentIntentFull).not.toHaveBeenCalled();
    expect(statusUpdate(mock)).toBeUndefined();
  });
});

describe('cancelAppointment — refund policy window', () => {
  const SETTINGS = [
    { scope: 'shop', barber_id: null, mins_cancel_before_appt: 300, shop_id: SHOP_A },
  ];

  it('paid + also_refund INSIDE the no-refund window → rejected, no refund issued', async () => {
    asManager();
    const mock = setup(
      fixtures({
        appointments: [
          apptRow({
            payment_status: 'paid',
            payment_intent_id: 'pi_1',
            start_at: new Date(Date.now() + 10 * 60_000).toISOString(), // 10 min away, inside 5h window
          }),
        ],
        barber_settings: SETTINGS,
      }),
    );

    const res = await cancelAppointment({ id: APPT_ID, also_refund: true });

    expect(res).toMatchObject({
      ok: false,
      errorCode: 'INVALID_INPUT',
      fieldErrors: { refund_policy: 'within_no_refund_window' },
    });
    expect(h.refundPaymentIntentFull).not.toHaveBeenCalled();
  });

  it('paid + also_refund OUTSIDE the window → refunds BEFORE the refunded-status write, then cancels', async () => {
    asManager();
    const mock = setup(
      fixtures({
        appointments: [apptRow({ payment_status: 'paid', payment_intent_id: 'pi_1' })], // far-future start
        barber_settings: SETTINGS,
      }),
    );

    const res = await cancelAppointment({ id: APPT_ID, also_refund: true });

    expect(res.ok).toBe(true);
    expect(h.refundPaymentIntentFull).toHaveBeenCalledWith({ paymentIntentId: 'pi_1' });
    expect(h.markRefundedByIntent).toHaveBeenCalled();
    // Refund must fire BEFORE the refunded-status write (irreversible-first).
    expect(h.refundPaymentIntentFull.mock.invocationCallOrder[0]!).toBeLessThan(
      h.markRefundedByIntent.mock.invocationCallOrder[0]!,
    );
    expect(statusUpdate(mock)).toBeDefined();
  });

  it('force_refund overrides the policy window → refund proceeds even inside it', async () => {
    asManager();
    setup(
      fixtures({
        appointments: [
          apptRow({
            payment_status: 'paid',
            payment_intent_id: 'pi_1',
            start_at: new Date(Date.now() + 10 * 60_000).toISOString(), // inside window
          }),
        ],
        barber_settings: SETTINGS,
      }),
    );

    const res = await cancelAppointment({ id: APPT_ID, also_refund: true, force_refund: true });

    expect(res.ok).toBe(true);
    expect(h.refundPaymentIntentFull).toHaveBeenCalledWith({ paymentIntentId: 'pi_1' });
  });
});
