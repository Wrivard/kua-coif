import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type Fixtures } from '@/lib/test/supabase-mock';

/**
 * Flow tests for the public booking action (`bookPublicAppointment`) — the
 * money path where an anonymous POST turns into a paid appointment. Exercised
 * end-to-end against the fixture-driven supabase mock (plan 015); every seam
 * with I/O or env is mocked and asserted via spies + captured filters.
 */

const h = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  verifyTurnstile: vi.fn(),
  verifyDepositPaymentIntent: vi.fn(),
  refundOwnedIntentBestEffort: vi.fn(),
  createDepositPaymentIntent: vi.fn(),
  getReusableDepositPaymentIntent: vi.fn(),
  sendEmail: vi.fn(),
  sendSlack: vi.fn(),
  captureException: vi.fn(),
  logDurableAudit: vi.fn(),
  logAuditAction: vi.fn(),
  checkAvailability: vi.fn(),
  effectiveLoyaltyBalanceCents: vi.fn(),
  signToken: vi.fn(),
  appUrl: vi.fn(),
  srClient: { current: null as unknown },
}));

vi.mock('@/lib/supabase/service-role', () => ({
  createSupabaseServiceRoleClient: () => h.srClient.current,
}));
vi.mock('next/headers', () => ({ headers: () => ({ get: () => null }) }));
vi.mock('@/lib/auth/rate-limit', () => ({
  checkRateLimit: (...a: unknown[]) => h.checkRateLimit(...a),
}));
vi.mock('@/lib/security/turnstile', () => ({
  verifyTurnstile: (...a: unknown[]) => h.verifyTurnstile(...a),
}));
vi.mock('@/lib/stripe/server', () => ({ stripeConfigured: () => true }));
vi.mock('@/lib/stripe/payments', () => ({
  verifyDepositPaymentIntent: (...a: unknown[]) => h.verifyDepositPaymentIntent(...a),
  refundOwnedIntentBestEffort: (...a: unknown[]) => h.refundOwnedIntentBestEffort(...a),
  createDepositPaymentIntent: (...a: unknown[]) => h.createDepositPaymentIntent(...a),
  getReusableDepositPaymentIntent: (...a: unknown[]) => h.getReusableDepositPaymentIntent(...a),
}));
vi.mock('@/lib/email/send', () => ({ sendEmail: (...a: unknown[]) => h.sendEmail(...a) }));
vi.mock('@/lib/email/templates/appointment-confirmation', () => ({
  AppointmentConfirmation: () => null,
}));
vi.mock('@/lib/notifications/slack', () => ({
  sendSlackBookingNotification: (...a: unknown[]) => h.sendSlack(...a),
}));
vi.mock('@/lib/observability', () => ({
  captureException: (...a: unknown[]) => h.captureException(...a),
}));
vi.mock('@/lib/audit-log', () => ({
  logDurableAudit: (...a: unknown[]) => h.logDurableAudit(...a),
  logAuditAction: (...a: unknown[]) => h.logAuditAction(...a),
}));
vi.mock('@/lib/business/availability', () => ({
  checkAvailability: (...a: unknown[]) => h.checkAvailability(...a),
}));
vi.mock('@/lib/business/loyalty', () => ({
  effectiveLoyaltyBalanceCents: (...a: unknown[]) => h.effectiveLoyaltyBalanceCents(...a),
}));
vi.mock('@/lib/security/signed-tokens', () => ({
  signToken: (...a: unknown[]) => h.signToken(...a),
}));
vi.mock('@/lib/env/app-url', () => ({ appUrl: () => h.appUrl() }));

import { bookPublicAppointment } from './actions';

const BARBER_ID = '11111111-1111-4111-8111-111111111111';
const SERVICE_ID = '22222222-2222-4222-8222-222222222222';

function shopRow(over: Record<string, unknown> = {}) {
  return {
    id: 'shop-1',
    name: 'Axum',
    timezone: 'America/Toronto',
    allow_booking_any_barber: true,
    street: '3857 Décarie',
    municipality: 'Montréal',
    province: 'QC',
    phone: '+15145551111',
    email_logo_url: null,
    email_accent_color: null,
    slack_webhook_url: null,
    stripe_account_id: 'acct_THIS',
    payment_mode: 'none',
    alias: 'axum',
    ...over,
  };
}

function baseFixtures(over: Partial<Fixtures> = {}): Fixtures {
  return {
    shops: [shopRow()],
    services: [
      {
        id: SERVICE_ID,
        shop_id: 'shop-1',
        name: 'Haircut',
        duration_min: 30,
        price: 30,
        status: 'enabled',
        deposit_amount_cents: 0,
      },
    ],
    barbers: [
      {
        id: BARBER_ID,
        shop_id: 'shop-1',
        status: 'confirmed',
        bookable: true,
        sort_order: 0,
        display_name: 'Olivier',
      },
    ],
    ...over,
  };
}

function validInput(over: Record<string, unknown> = {}) {
  return {
    shop_slug: 'axum',
    barber_id: BARBER_ID,
    service_ids: [SERVICE_ID],
    date: '2026-09-01',
    start_time: '10:00',
    first_name: 'Ada',
    phone: '+15145551234',
    email: 'ada@example.com',
    consent_loi25: true,
    locale: 'fr',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.checkRateLimit.mockResolvedValue({ allowed: true });
  h.verifyTurnstile.mockResolvedValue({ ok: true });
  h.checkAvailability.mockReturnValue({ ok: true });
  h.effectiveLoyaltyBalanceCents.mockResolvedValue(0);
  h.sendEmail.mockResolvedValue(undefined);
  h.logDurableAudit.mockResolvedValue(undefined);
  h.signToken.mockReturnValue('tok');
  h.appUrl.mockReturnValue('http://localhost');
  h.srClient.current = null;
});

describe('bookPublicAppointment', () => {
  it('happy path (no payment): inserts appointment + services and sends the confirmation email', async () => {
    const mock = createSupabaseMock(baseFixtures());
    h.srClient.current = mock.client;

    const res = await bookPublicAppointment(validInput());

    expect(res.ok).toBe(true);
    // The shop was resolved by its alias — a captured-filter assertion.
    const shopSelect = mock.calls.find((c) => c.table === 'shops' && c.op === 'select');
    expect(shopSelect?.filters).toContainEqual(['alias', 'axum']);
    // Appointment + its services were written.
    const apptInsert = mock.calls.find((c) => c.table === 'appointments' && c.op === 'insert');
    expect(apptInsert?.payload).toMatchObject({
      shop_id: 'shop-1',
      barber_id: BARBER_ID,
      source: 'online',
    });
    expect(mock.calls.some((c) => c.table === 'appointment_services' && c.op === 'insert')).toBe(
      true,
    );
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('a failing confirmation email does NOT affect the booking result (plan 018 deferred send)', async () => {
    // The email is dispatched via waitUntil(...).catch(...) off the critical
    // path, so a transport failure must never change the action's result.
    h.sendEmail.mockRejectedValue(new Error('smtp exploded'));
    const mock = createSupabaseMock(baseFixtures());
    h.srClient.current = mock.client;

    const res = await bookPublicAppointment(validInput());

    expect(res.ok).toBe(true);
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    // The deferred send's own rejection is swallowed into Sentry (never an
    // unhandled rejection). Flush microtasks so the .catch has run.
    await new Promise((r) => setTimeout(r, 0));
    expect(h.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ step: 'confirmation-email-deferred' }),
      }),
    );
  });

  it('slot race: a 23505 on the appointment insert maps to CONFLICT and refunds the charged PI', async () => {
    h.verifyDepositPaymentIntent.mockResolvedValue({ valid: true, status: 'succeeded' });
    h.refundOwnedIntentBestEffort.mockResolvedValue({ refunded: true });
    const mock = createSupabaseMock(baseFixtures({ shops: [shopRow({ payment_mode: 'full' })] }), {
      errors: { appointments: { insert: { code: '23505', message: 'unique_violation' } } },
    });
    h.srClient.current = mock.client;

    const res = await bookPublicAppointment(
      validInput({ payment_intent_id: 'pi_abcdefgh1234', deposit_amount_cents: 3000 }),
    );

    expect(res).toMatchObject({ ok: false, errorCode: 'CONFLICT' });
    expect(h.refundOwnedIntentBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentIntentId: 'pi_abcdefgh1234',
        expectedConnectedAccountId: 'acct_THIS',
      }),
    );
  });

  it('PI verify rejects → UNEXPECTED and the failure is captured to Sentry', async () => {
    h.verifyDepositPaymentIntent.mockResolvedValue({ valid: false, reason: 'wrong_amount' });
    h.refundOwnedIntentBestEffort.mockResolvedValue({ refunded: true });
    const mock = createSupabaseMock(baseFixtures({ shops: [shopRow({ payment_mode: 'full' })] }));
    h.srClient.current = mock.client;

    const res = await bookPublicAppointment(
      validInput({ payment_intent_id: 'pi_abcdefgh1234', deposit_amount_cents: 3000 }),
    );

    expect(res).toMatchObject({ ok: false, errorCode: 'UNEXPECTED' });
    expect(h.captureException).toHaveBeenCalled();
    // No appointment row was inserted when the PI verify failed.
    expect(mock.calls.some((c) => c.table === 'appointments' && c.op === 'insert')).toBe(false);
  });

  it('promo first_appointment_only with a prior appointment → INVALID_INPUT { promo_code: first_only }', async () => {
    const mock = createSupabaseMock(
      baseFixtures({
        promo_codes: [
          {
            id: 'promo-1',
            shop_id: 'shop-1',
            code: 'FIRST',
            type: 'percent',
            value: 10,
            first_appointment_only: true,
            one_time: false,
            expiration_date: null,
            redemptions: 0,
          },
        ],
        clients: [
          {
            id: 'client-1',
            shop_id: 'shop-1',
            phone_normalized: '5145551234',
            loyalty_balance_cents: 0,
          },
        ],
        appointments: [
          // Prior appointment, far in the past so it's excluded from the
          // availability day-window read but found by the first-appt check.
          {
            id: 'old-appt',
            shop_id: 'shop-1',
            client_id: 'client-1',
            barber_id: BARBER_ID,
            start_at: '2020-01-01T10:00:00.000Z',
            end_at: '2020-01-01T10:30:00.000Z',
            status: 'completed',
          },
        ],
      }),
    );
    h.srClient.current = mock.client;

    const res = await bookPublicAppointment(validInput({ promo_code: 'FIRST' }));

    expect(res).toMatchObject({
      ok: false,
      errorCode: 'INVALID_INPUT',
      fieldErrors: { promo_code: 'first_only' },
    });
    // The prior-appointment lookup filtered by the resolved client id.
    const priorLookup = mock.calls.find(
      (c) =>
        c.table === 'appointments' &&
        c.op === 'select' &&
        c.filters.some(([k]) => k === 'client_id'),
    );
    expect(priorLookup?.filters).toContainEqual(['client_id', 'client-1']);
  });

  it('link-services failure rolls back the orphaned appointment with a compensating DELETE', async () => {
    const mock = createSupabaseMock(baseFixtures(), {
      errors: { appointment_services: { insert: { code: 'XX000', message: 'boom' } } },
    });
    h.srClient.current = mock.client;

    const res = await bookPublicAppointment(validInput());

    expect(res).toMatchObject({ ok: false, errorCode: 'UNEXPECTED' });
    // The appointment we just created is deleted by id.
    const del = mock.calls.find((c) => c.table === 'appointments' && c.op === 'delete');
    expect(del).toBeDefined();
    expect(del?.filters.some(([k]) => k === 'id')).toBe(true);
  });

  it('honeypot filled → rejected with ZERO database calls', async () => {
    // NOTE (drift from plan 015 case 6): the live schema declares
    // `hp: z.string().max(0)`, so a filled honeypot is rejected at the Zod
    // parse step (INVALID_INPUT, with an `hp` field error) BEFORE the
    // dedicated `if (input.hp)` fake-success branch — that branch is now
    // effectively dead. The protective BEHAVIOR the plan cares about still
    // holds: a bot is rejected and ZERO database work happens. Asserted on
    // the real behavior rather than the unreachable `honeypot-discard`.
    const mock = createSupabaseMock(baseFixtures());
    h.srClient.current = mock.client;

    const res = await bookPublicAppointment(validInput({ hp: 'i-am-a-bot' }));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.errorCode).toBe('INVALID_INPUT');
    expect(res.fieldErrors).toMatchObject({ hp: expect.any(String) });
    expect(mock.calls).toHaveLength(0);
  });
});
