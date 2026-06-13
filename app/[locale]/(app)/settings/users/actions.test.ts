import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type Fixtures } from '@/lib/test/supabase-mock';

/**
 * settings/users `inviteUser` — W1a owner-guard (privilege-escalation lockdown).
 *
 * Mirrors `updateMember`'s "only an owner can grant the owner role": a manager
 * must NOT be able to invite or link a member as `owner`, while owners and
 * non-owner invites still pass. Harness = lib/test/supabase-mock; structure
 * mirrors services/actions.test.ts. `inviteUser` resolves the existing-profile
 * path (Path A) which the harness covers end-to-end; the guard sits at the top
 * of `run`, so it also protects the brand-new-invite path (Path B).
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
// `inviteUser` writes through the SERVICE-ROLE client (it flips invite state
// the invitee's own RLS can't); the server client is mocked too so the rest of
// the module (updateMember/removeMember) resolves if ever imported alongside.
vi.mock('@/lib/supabase/service-role', () => ({
  createSupabaseServiceRoleClient: () => h.sbClient.current,
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: () => h.sbClient.current }));
vi.mock('@/lib/audit-log', () => ({
  logAuditAction: (...a: unknown[]) => h.logAuditAction(...a),
  logDurableAudit: (...a: unknown[]) => h.logDurableAudit(...a),
}));
vi.mock('next/cache', () => ({
  revalidatePath: (...a: unknown[]) => h.revalidatePath(...a),
  revalidateTag: (...a: unknown[]) => h.revalidateTag(...a),
}));

import { inviteUser } from './actions';

const SHOP_A = 'shop-a';
const EXISTING_EMAIL = 'existing@example.com';
const EXISTING_USER = 'user-existing';

function setup(fixtures: Fixtures) {
  const mock = createSupabaseMock(fixtures);
  h.sbClient.current = mock.client;
  return { mock };
}

function asRole(role: 'owner' | 'manager') {
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

describe('inviteUser — owner-guard (W1a)', () => {
  it('manager inviting role=owner → FORBIDDEN, no shop_members write', async () => {
    asRole('manager');
    const { mock } = setup({
      profiles: [{ id: EXISTING_USER, email: EXISTING_EMAIL }],
      shop_members: [],
    });

    const res = await inviteUser({ email: EXISTING_EMAIL, role: 'owner' });

    expect(res).toMatchObject({ ok: false, errorCode: 'FORBIDDEN' });
    // Guard short-circuits before any DB access.
    expect(mock.calls.some((c) => c.table === 'shop_members' && c.op === 'insert')).toBe(false);
    // AUTHZ-R1 — no membership changed, so the cache is not busted.
    expect(h.revalidateTag).not.toHaveBeenCalled();
  });

  it('owner inviting role=owner → ok (existing profile linked confirmed)', async () => {
    asRole('owner');
    const { mock } = setup({
      profiles: [{ id: EXISTING_USER, email: EXISTING_EMAIL }],
      shop_members: [],
    });

    const res = await inviteUser({ email: EXISTING_EMAIL, role: 'owner' });

    expect(res.ok).toBe(true);
    const ins = mock.calls.find((c) => c.table === 'shop_members' && c.op === 'insert');
    expect(ins?.payload).toMatchObject({
      shop_id: SHOP_A,
      user_id: EXISTING_USER,
      role: 'owner',
      status: 'confirmed',
    });
    // AUTHZ-R1 — the new membership busts the memberships cache.
    expect(h.revalidateTag).toHaveBeenCalledWith('memberships');
  });

  it('manager inviting a non-owner (barber) → ok, shop-scoped insert', async () => {
    asRole('manager');
    const { mock } = setup({
      profiles: [{ id: EXISTING_USER, email: EXISTING_EMAIL }],
      shop_members: [],
    });

    const res = await inviteUser({ email: EXISTING_EMAIL, role: 'barber' });

    expect(res.ok).toBe(true);
    const ins = mock.calls.find((c) => c.table === 'shop_members' && c.op === 'insert');
    expect(ins?.payload).toMatchObject({ shop_id: SHOP_A, role: 'barber', status: 'confirmed' });
    // AUTHZ-R1 — the new membership busts the memberships cache.
    expect(h.revalidateTag).toHaveBeenCalledWith('memberships');
  });
});
