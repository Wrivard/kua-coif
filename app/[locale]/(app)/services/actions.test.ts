import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type Fixtures } from '@/lib/test/supabase-mock';

/**
 * Services catalog actions (Services W1) on the fixture harness — mirror of
 * products/actions.test.ts. Covers the integrity fixes: same-shop validation
 * of category_id, the set_service_taxes RPC (atomic tax linking) with orphan
 * cleanup, tax_ids dedup at the schema edge, shop-scoped deletes, and the
 * FK-conflict (23503) → CONFLICT mapping on deleteService.
 */

const h = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getShopMemberships: vi.fn(),
  getCurrentShopId: vi.fn(),
  getCurrentBarberId: vi.fn(),
  captureException: vi.fn(),
  logAuditAction: vi.fn(),
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
vi.mock('@/lib/audit-log', () => ({ logAuditAction: (...a: unknown[]) => h.logAuditAction(...a) }));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => h.revalidatePath(...a) }));
// services/actions.ts also busts the public-surface + shop-config caches —
// no-op them (their internals call next/cache outside a request scope).
vi.mock('@/lib/server-actions/revalidate', () => ({
  revalidatePublicShopSurfaces: () => undefined,
  revalidateShopConfig: () => undefined,
}));

import { createService, updateService, deleteService } from './actions';

const SHOP_A = 'shop-a';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';
const TAX_ID = '33333333-3333-4333-8333-333333333333';
const TAX_ID2 = '44444444-4444-4444-8444-444444444444';
const SERVICE_ID = '55555555-5555-4555-8555-555555555555';

function setup(fixtures: Fixtures, errors?: Parameters<typeof createSupabaseMock>[1]) {
  const mock = createSupabaseMock(fixtures, errors);
  const rpc = vi.fn().mockResolvedValue({ error: null });
  // The harness throws on rpc() by default (unsupported op) — override with a
  // spy so the action's set_service_taxes call is observable + controllable.
  (mock.client as { rpc: unknown }).rpc = (...a: unknown[]) => rpc(...a);
  h.sbClient.current = mock.client;
  return { mock, rpc };
}

function serviceInput(over: Record<string, unknown> = {}) {
  return {
    name: 'Coupe homme',
    category_id: null as string | null,
    duration_min: 30,
    price: 34.79,
    status: 'enabled',
    tax_ids: [TAX_ID],
    deposit_amount_cents: 0,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getCurrentUser.mockResolvedValue({ id: 'user-mgr' });
  h.getShopMemberships.mockResolvedValue([
    { shop_id: SHOP_A, role: 'manager', status: 'confirmed' },
  ]);
  h.getCurrentShopId.mockResolvedValue(SHOP_A);
  h.getCurrentBarberId.mockResolvedValue(null);
  h.logAuditAction.mockResolvedValue(undefined);
  h.sbClient.current = null;
});

describe('createService', () => {
  it('happy path: inserts the service (shop-scoped) and links taxes via the RPC', async () => {
    const { mock, rpc } = setup({
      services: [],
      service_categories: [{ id: CATEGORY_ID, shop_id: SHOP_A }],
    });

    const res = await createService(serviceInput({ category_id: CATEGORY_ID }));

    expect(res.ok).toBe(true);
    const ins = mock.calls.find((c) => c.table === 'services' && c.op === 'insert');
    expect(ins?.payload).toMatchObject({
      shop_id: SHOP_A,
      name: 'Coupe homme',
      category_id: CATEGORY_ID,
    });
    expect(rpc).toHaveBeenCalledWith('set_service_taxes', {
      p_service_id: expect.any(String),
      p_tax_ids: [TAX_ID],
    });
  });

  it('rejects a category_id from another shop → INVALID_INPUT, no service inserted', async () => {
    // No matching (id, shop_id) row → categoryBelongsToShop resolves to null.
    const { mock } = setup({ services: [], service_categories: [] });

    const res = await createService(serviceInput({ category_id: CATEGORY_ID }));

    expect(res).toMatchObject({ ok: false, errorCode: 'INVALID_INPUT' });
    expect(mock.calls.some((c) => c.table === 'services' && c.op === 'insert')).toBe(false);
  });

  it('RPC failure (cross-shop tax) → UNEXPECTED + Sentry + best-effort orphan delete', async () => {
    const { mock, rpc } = setup({ services: [] });
    rpc.mockResolvedValue({ error: { message: 'TAX_WRONG_SHOP' } });

    const res = await createService(serviceInput());

    expect(res).toMatchObject({ ok: false, errorCode: 'UNEXPECTED' });
    expect(h.captureException).toHaveBeenCalled();
    const del = mock.calls.find((c) => c.table === 'services' && c.op === 'delete');
    expect(del).toBeDefined();
    expect(del?.filters).toContainEqual(['shop_id', SHOP_A]);
  });

  it('dedups tax_ids before they reach the RPC (schema transform)', async () => {
    const { rpc } = setup({ services: [] });

    await createService(serviceInput({ tax_ids: [TAX_ID, TAX_ID, TAX_ID2] }));

    expect(rpc).toHaveBeenCalledWith('set_service_taxes', {
      p_service_id: expect.any(String),
      p_tax_ids: [TAX_ID, TAX_ID2],
    });
  });
});

describe('updateService', () => {
  it('rejects a category_id from another shop → INVALID_INPUT, nothing mutated', async () => {
    const { mock } = setup({
      services: [{ id: SERVICE_ID, shop_id: SHOP_A, name: 'Coupe homme' }],
      service_categories: [{ id: CATEGORY_ID, shop_id: 'shop-OTHER' }],
    });

    const res = await updateService({
      id: SERVICE_ID,
      ...serviceInput({ category_id: CATEGORY_ID }),
    });

    expect(res).toMatchObject({ ok: false, errorCode: 'INVALID_INPUT' });
    expect(mock.calls.some((c) => c.table === 'services' && c.op === 'update')).toBe(false);
    expect(mock.tables.services![0]!.name).toBe('Coupe homme');
  });

  it('links taxes via the RPC with the update (shop-scoped write)', async () => {
    const { mock, rpc } = setup({
      services: [{ id: SERVICE_ID, shop_id: SHOP_A, name: 'Old' }],
    });

    const res = await updateService({ id: SERVICE_ID, ...serviceInput() });

    expect(res.ok).toBe(true);
    const upd = mock.calls.find((c) => c.table === 'services' && c.op === 'update');
    expect(upd?.filters).toEqual([
      ['id', SERVICE_ID],
      ['shop_id', SHOP_A],
    ]);
    expect(rpc).toHaveBeenCalledWith('set_service_taxes', {
      p_service_id: SERVICE_ID,
      p_tax_ids: [TAX_ID],
    });
  });
});

describe('deleteService', () => {
  it('is shop-scoped: a foreign-shop row is filtered out and survives', async () => {
    const { mock } = setup({
      services: [{ id: SERVICE_ID, shop_id: 'shop-OTHER', name: 'X' }],
    });

    const res = await deleteService({ id: SERVICE_ID });

    expect(res.ok).toBe(true); // delete of 0 rows is not an error
    const del = mock.calls.find((c) => c.table === 'services' && c.op === 'delete');
    expect(del?.filters).toEqual([
      ['id', SERVICE_ID],
      ['shop_id', SHOP_A],
    ]);
    // The other shop's row was untouched.
    expect(mock.tables.services).toHaveLength(1);
  });

  it('maps a 23503 FK violation (booking history) to CONFLICT, not Sentry', async () => {
    setup(
      { services: [{ id: SERVICE_ID, shop_id: SHOP_A }] },
      { errors: { services: { delete: { code: '23503', message: 'fk' } } } },
    );

    const res = await deleteService({ id: SERVICE_ID });

    expect(res).toMatchObject({ ok: false, errorCode: 'CONFLICT' });
    expect(h.captureException).not.toHaveBeenCalled();
  });
});
