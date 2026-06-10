import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type Fixtures } from '@/lib/test/supabase-mock';

/**
 * Products catalog actions (W1) on the fixture harness. Covers the integrity
 * fixes: same-shop validation of brand/category, the set_product_taxes RPC
 * (atomic tax linking) with orphan cleanup, tax_ids dedup, shop-scoped
 * mutations, and the FK-conflict → CONFLICT mapping.
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

import { createProduct, updateProduct, deleteBrand } from './actions';

const SHOP_A = 'shop-a';
const BRAND_ID = '11111111-1111-4111-8111-111111111111';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';
const TAX_ID = '33333333-3333-4333-8333-333333333333';
const TAX_ID2 = '44444444-4444-4444-8444-444444444444';
const PRODUCT_ID = '55555555-5555-4555-8555-555555555555';

function setup(fixtures: Fixtures, errors?: Parameters<typeof createSupabaseMock>[1]) {
  const mock = createSupabaseMock(fixtures, errors);
  const rpc = vi.fn().mockResolvedValue({ error: null });
  // The harness throws on rpc() by default (unsupported op) — override with a
  // spy so the action's set_product_taxes call is observable + controllable.
  (mock.client as { rpc: unknown }).rpc = (...a: unknown[]) => rpc(...a);
  h.sbClient.current = mock.client;
  return { mock, rpc };
}

function productInput(over: Record<string, unknown> = {}) {
  return {
    name: 'Pommade',
    brand_id: null as string | null,
    category_id: null as string | null,
    price: 10,
    supply_price: 5,
    current_inventory: 3,
    low_inventory_threshold: 1,
    sku: null as string | null,
    tax_ids: [TAX_ID],
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

describe('createProduct', () => {
  it('happy path: inserts the product (shop-scoped) and links taxes via the RPC', async () => {
    const { mock, rpc } = setup({
      products: [],
      product_brands: [{ id: BRAND_ID, shop_id: SHOP_A }],
      product_categories: [{ id: CATEGORY_ID, shop_id: SHOP_A }],
    });

    const res = await createProduct(productInput({ brand_id: BRAND_ID, category_id: CATEGORY_ID }));

    expect(res.ok).toBe(true);
    const ins = mock.calls.find((c) => c.table === 'products' && c.op === 'insert');
    expect(ins?.payload).toMatchObject({ shop_id: SHOP_A, name: 'Pommade', brand_id: BRAND_ID });
    expect(rpc).toHaveBeenCalledWith('set_product_taxes', {
      p_product_id: expect.any(String),
      p_tax_ids: [TAX_ID],
    });
  });

  it('rejects a brand_id from another shop → INVALID_INPUT, no product inserted', async () => {
    // No matching (id, shop_id) row → belongsToShop resolves to null.
    const { mock } = setup({ products: [], product_brands: [] });

    const res = await createProduct(productInput({ brand_id: BRAND_ID }));

    expect(res).toMatchObject({ ok: false, errorCode: 'INVALID_INPUT' });
    expect(mock.calls.some((c) => c.table === 'products' && c.op === 'insert')).toBe(false);
  });

  it('RPC failure → UNEXPECTED + Sentry + best-effort orphan delete', async () => {
    const { mock, rpc } = setup({
      products: [],
      product_brands: [{ id: BRAND_ID, shop_id: SHOP_A }],
    });
    rpc.mockResolvedValue({ error: { message: 'TAX_WRONG_SHOP' } });

    const res = await createProduct(productInput({ brand_id: BRAND_ID }));

    expect(res).toMatchObject({ ok: false, errorCode: 'UNEXPECTED' });
    expect(h.captureException).toHaveBeenCalled();
    const del = mock.calls.find((c) => c.table === 'products' && c.op === 'delete');
    expect(del).toBeDefined();
    expect(del?.filters).toContainEqual(['shop_id', SHOP_A]);
  });

  it('dedups tax_ids before they reach the RPC', async () => {
    const { rpc } = setup({ products: [] });

    await createProduct(productInput({ tax_ids: [TAX_ID, TAX_ID, TAX_ID2] }));

    expect(rpc).toHaveBeenCalledWith('set_product_taxes', {
      p_product_id: expect.any(String),
      p_tax_ids: [TAX_ID, TAX_ID2],
    });
  });
});

describe('updateProduct', () => {
  it('is shop-scoped: a foreign-shop row is filtered out and never mutated', async () => {
    const { mock } = setup({
      products: [{ id: PRODUCT_ID, shop_id: 'shop-OTHER', name: 'X', price: 5 }],
    });

    const res = await updateProduct({
      id: PRODUCT_ID,
      name: 'Hacked',
      brand_id: null,
      category_id: null,
      price: 9,
      supply_price: 1,
      current_inventory: 0,
      low_inventory_threshold: 0,
      sku: null,
      tax_ids: [],
    });

    expect(res.ok).toBe(true); // update of 0 rows is not an error
    const upd = mock.calls.find((c) => c.table === 'products' && c.op === 'update');
    expect(upd?.filters).toEqual([
      ['id', PRODUCT_ID],
      ['shop_id', SHOP_A],
    ]);
    // The other shop's row was untouched.
    expect(mock.tables.products![0]!.name).toBe('X');
  });
});

describe('deleteBrand', () => {
  it('maps a 23503 FK violation to CONFLICT (not UNEXPECTED, not Sentry)', async () => {
    setup(
      { product_brands: [{ id: BRAND_ID, shop_id: SHOP_A }] },
      { errors: { product_brands: { delete: { code: '23503', message: 'fk' } } } },
    );

    const res = await deleteBrand({ id: BRAND_ID });

    expect(res).toMatchObject({ ok: false, errorCode: 'CONFLICT' });
    expect(h.captureException).not.toHaveBeenCalled();
  });
});
