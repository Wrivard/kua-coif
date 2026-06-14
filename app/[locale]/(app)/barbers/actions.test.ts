import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type Fixtures } from '@/lib/test/supabase-mock';

/**
 * barbers `inviteBarber` (B8) — invite-by-email so a barber can self-login.
 *
 * Covers the security gate (the chair must belong to the caller's ACTIVE shop —
 * no cross-tenant link), the already-linked CONFLICT, the manager-only gate, and
 * the happy Path A (existing Küa profile → link the chair + ensure a confirmed
 * barber membership + bust the memberships cache). Harness = lib/test/
 * supabase-mock; mirrors settings/users/actions.test. Path B (brand-new invite
 * via auth.admin) isn't covered here — the resolver is shared with inviteUser and
 * auth.admin isn't part of the fixture client; Path A exercises the link
 * end-to-end.
 */

const h = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getShopMemberships: vi.fn(),
  getCurrentShopId: vi.fn(),
  getCurrentBarberId: vi.fn(),
  captureException: vi.fn(),
  logAuditAction: vi.fn(),
  logDurableAudit: vi.fn(),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  sbClient: { current: null as unknown },
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentUser: () => h.getCurrentUser(),
  getShopMemberships: () => h.getShopMemberships(),
  getCurrentShopId: () => h.getCurrentShopId(),
  getCurrentBarberId: () => h.getCurrentBarberId(),
  MEMBERSHIPS_CACHE_TAG: 'memberships',
}));
vi.mock('@/lib/observability', () => ({
  captureException: (...a: unknown[]) => h.captureException(...a),
}));
// `inviteBarber` writes through the SERVICE-ROLE client; the server client is
// mocked too so the rest of the module resolves if imported alongside.
vi.mock('@/lib/supabase/service-role', () => ({
  createSupabaseServiceRoleClient: () => h.sbClient.current,
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: () => h.sbClient.current }));
vi.mock('@/lib/audit-log', () => ({
  logAuditAction: (...a: unknown[]) => h.logAuditAction(...a),
  logDurableAudit: (...a: unknown[]) => h.logDurableAudit(...a),
}));
// Stub the public-surface revalidators (inviteBarber never calls them) so the
// test doesn't pull in the calendar-config cache chain.
vi.mock('@/lib/server-actions/revalidate', () => ({
  revalidatePublicShopSurfaces: vi.fn(),
  revalidateShopConfig: vi.fn(),
  revalidateShopRow: vi.fn(),
}));
vi.mock('next/cache', () => ({
  revalidatePath: (...a: unknown[]) => h.revalidatePath(...a),
  revalidateTag: (...a: unknown[]) => h.revalidateTag(...a),
}));

import { inviteBarber } from './actions';

const SHOP_A = 'shop-a';
const SHOP_B = 'shop-b';
// barber_id is schema-validated as a UUID — use a real one.
const BARBER_A = '11111111-1111-4111-8111-111111111111';
const EXISTING_EMAIL = 'cutter@example.com';
const EXISTING_USER = 'user-existing';

function setup(fixtures: Fixtures) {
  const mock = createSupabaseMock(fixtures);
  h.sbClient.current = mock.client;
  return { mock };
}

function asRole(role: 'owner' | 'manager' | 'barber') {
  h.getShopMemberships.mockResolvedValue([{ shop_id: SHOP_A, role, status: 'confirmed' }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getCurrentUser.mockResolvedValue({ id: 'user-actor' });
  h.getCurrentShopId.mockResolvedValue(SHOP_A);
  h.getCurrentBarberId.mockResolvedValue(null);
  h.logAuditAction.mockResolvedValue(undefined);
  h.logDurableAudit.mockResolvedValue(undefined);
  h.sbClient.current = null;
});

describe('inviteBarber (B8)', () => {
  it('links an existing-profile barber: writes user_id, confirms membership, busts cache', async () => {
    asRole('manager');
    const { mock } = setup({
      barbers: [{ id: BARBER_A, shop_id: SHOP_A, status: 'confirmed', user_id: null }],
      profiles: [{ id: EXISTING_USER, email: EXISTING_EMAIL }],
      shop_members: [],
    });

    const res = await inviteBarber({ barber_id: BARBER_A, email: EXISTING_EMAIL });

    expect(res).toMatchObject({ ok: true, data: { status: 'confirmed' } });
    // The link write — scoped to id + active shop.
    const upd = mock.calls.find((c) => c.table === 'barbers' && c.op === 'update');
    expect(upd?.payload).toMatchObject({ user_id: EXISTING_USER });
    expect(upd?.filters).toEqual(
      expect.arrayContaining([
        ['id', BARBER_A],
        ['shop_id', SHOP_A],
      ]),
    );
    // Membership ensured as a confirmed barber.
    const ins = mock.calls.find((c) => c.table === 'shop_members' && c.op === 'insert');
    expect(ins?.payload).toMatchObject({
      shop_id: SHOP_A,
      user_id: EXISTING_USER,
      role: 'barber',
      status: 'confirmed',
    });
    // AUTHZ-R1 — a membership was created; bust the memberships cache.
    expect(h.revalidateTag).toHaveBeenCalledWith('memberships');
  });

  it('refuses a chair from a foreign shop → NOT_FOUND, no link write', async () => {
    asRole('manager');
    const { mock } = setup({
      barbers: [{ id: BARBER_A, shop_id: SHOP_B, status: 'confirmed', user_id: null }],
      profiles: [{ id: EXISTING_USER, email: EXISTING_EMAIL }],
      shop_members: [],
    });

    const res = await inviteBarber({ barber_id: BARBER_A, email: EXISTING_EMAIL });

    expect(res).toMatchObject({ ok: false, errorCode: 'NOT_FOUND' });
    expect(mock.calls.some((c) => c.table === 'barbers' && c.op === 'update')).toBe(false);
    expect(h.revalidateTag).not.toHaveBeenCalled();
  });

  it('refuses an already-linked chair → CONFLICT, no link write', async () => {
    asRole('manager');
    const { mock } = setup({
      barbers: [{ id: BARBER_A, shop_id: SHOP_A, status: 'confirmed', user_id: 'someone-else' }],
      profiles: [{ id: EXISTING_USER, email: EXISTING_EMAIL }],
      shop_members: [],
    });

    const res = await inviteBarber({ barber_id: BARBER_A, email: EXISTING_EMAIL });

    expect(res).toMatchObject({ ok: false, errorCode: 'CONFLICT' });
    expect(mock.calls.some((c) => c.table === 'barbers' && c.op === 'update')).toBe(false);
  });

  it('rejects a non-manager caller → FORBIDDEN before any DB access', async () => {
    asRole('barber');
    const { mock } = setup({
      barbers: [{ id: BARBER_A, shop_id: SHOP_A, status: 'confirmed', user_id: null }],
      profiles: [{ id: EXISTING_USER, email: EXISTING_EMAIL }],
      shop_members: [],
    });

    const res = await inviteBarber({ barber_id: BARBER_A, email: EXISTING_EMAIL });

    expect(res).toMatchObject({ ok: false, errorCode: 'FORBIDDEN' });
    expect(mock.calls.length).toBe(0);
  });
});
