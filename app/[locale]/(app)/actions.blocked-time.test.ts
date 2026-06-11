import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type Fixtures } from '@/lib/test/supabase-mock';

/**
 * Plan 040 (CAL-03) — `deleteBlockedTime` scope + audit matrix. A destructive
 * inventory action MUST be tenant-scoped and leave a durable trail (the
 * blocked_time table has no audit trigger and `logAuditAction` is a runtime
 * no-op). Same harness idiom as actions.cancel-refund.test.ts: withAction
 * runs for real, the auth seam fabricates ctx, the DB goes through the
 * fixture mock with captured filters.
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

import { deleteBlockedTime } from './actions';

const BLOCK_ID = '44444444-4444-4444-8444-444444444444';
const SHOP_A = 'shop-a';

function asManager() {
  h.getCurrentUser.mockResolvedValue({ id: 'user-mgr' });
  h.getShopMemberships.mockResolvedValue([
    { shop_id: SHOP_A, role: 'manager', status: 'confirmed' },
  ]);
  h.getCurrentShopId.mockResolvedValue(SHOP_A);
  h.getCurrentBarberId.mockResolvedValue(null);
}
function asBarber() {
  h.getCurrentUser.mockResolvedValue({ id: 'user-barber' });
  h.getShopMemberships.mockResolvedValue([
    { shop_id: SHOP_A, role: 'barber', status: 'confirmed' },
  ]);
  h.getCurrentShopId.mockResolvedValue(SHOP_A);
  h.getCurrentBarberId.mockResolvedValue('barber-1');
}

function blockRow(over: Record<string, unknown> = {}) {
  return {
    id: BLOCK_ID,
    shop_id: SHOP_A,
    barber_id: null,
    start_at: '2026-09-01T16:00:00.000Z',
    end_at: '2026-09-01T17:00:00.000Z',
    reason: 'Lunch',
    ...over,
  };
}

function fixtures(over: Partial<Fixtures> = {}): Fixtures {
  return { blocked_time: [blockRow()], ...over };
}

function setup(fx: Fixtures) {
  const mock = createSupabaseMock(fx);
  h.sbClient.current = mock.client;
  return mock;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.checkRateLimit.mockResolvedValue({ allowed: true });
  h.logDurableAudit.mockResolvedValue(undefined);
  h.sbClient.current = null;
});

describe('deleteBlockedTime — scope + audit', () => {
  it('manager deletes an own-shop block: shop-scoped delete + durable audit + revalidate', async () => {
    asManager();
    const mock = setup(fixtures());

    const res = await deleteBlockedTime({ id: BLOCK_ID });

    expect(res).toMatchObject({ ok: true, data: { id: BLOCK_ID } });
    // The destructive query carried BOTH filters — id AND the active shop.
    const del = mock.calls.find((c) => c.table === 'blocked_time' && c.op === 'delete');
    expect(del?.filters).toContainEqual(['id', BLOCK_ID]);
    expect(del?.filters).toContainEqual(['shop_id', SHOP_A]);
    // Durable trail (no trigger covers blocked_time deletes).
    expect(h.logDurableAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId: SHOP_A,
        action: 'delete',
        entity: 'blocked_time',
        entityId: BLOCK_ID,
      }),
    );
    expect(h.revalidatePath).toHaveBeenCalled();
  });

  it("a foreign shop's block id deletes nothing → NOT_FOUND, no audit", async () => {
    asManager();
    setup(fixtures({ blocked_time: [blockRow({ shop_id: 'shop-b' })] }));

    const res = await deleteBlockedTime({ id: BLOCK_ID });

    expect(res).toMatchObject({ ok: false, errorCode: 'NOT_FOUND' });
    expect(h.logDurableAudit).not.toHaveBeenCalled();
  });

  it('a barber is refused by the manager role gate', async () => {
    asBarber();
    setup(fixtures());

    const res = await deleteBlockedTime({ id: BLOCK_ID });

    expect(res).toMatchObject({ ok: false, errorCode: 'FORBIDDEN' });
    expect(h.logDurableAudit).not.toHaveBeenCalled();
  });
});
