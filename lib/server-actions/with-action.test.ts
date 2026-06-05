import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/**
 * Tests for the `withAction` Server Action wrapper — the single gate every
 * CRUD mutation flows through. We mock the auth/shop resolution helpers it
 * imports from `@/lib/auth/server` and the observability hook so the wrapper's
 * own branching logic is exercised in isolation (no Supabase, no cookies).
 *
 * Covered gates:
 *   - UNAUTHENTICATED when there's no user
 *   - NO_SHOP when the user has no confirmed membership
 *   - FORBIDDEN when the user's role in the active shop is below minRole
 *   - INVALID_INPUT (+ fieldErrors) on a Zod validation failure
 *   - UNEXPECTED when `run` throws (and observability is notified)
 *   - the success path (ctx is populated, ok(data) is returned)
 */

const getCurrentUser = vi.fn();
const getShopMemberships = vi.fn();
const getCurrentShopId = vi.fn();
const getCurrentBarberId = vi.fn();
const captureException = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  getCurrentUser: () => getCurrentUser(),
  getShopMemberships: () => getShopMemberships(),
  getCurrentShopId: () => getCurrentShopId(),
  getCurrentBarberId: () => getCurrentBarberId(),
}));

vi.mock('@/lib/observability', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

import { withAction } from './with-action';

const USER = { id: 'user-1' };
const SHOP_A = 'shop-a';

function membership(role: 'owner' | 'manager' | 'barber', shop_id = SHOP_A) {
  return { shop_id, role, status: 'confirmed' as const };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible authenticated defaults; individual tests override as needed.
  getCurrentUser.mockResolvedValue(USER);
  getShopMemberships.mockResolvedValue([membership('owner')]);
  getCurrentShopId.mockResolvedValue(SHOP_A);
  getCurrentBarberId.mockResolvedValue(null);
});

describe('withAction — auth & shop gates', () => {
  it('returns UNAUTHENTICATED when there is no user', async () => {
    getCurrentUser.mockResolvedValue(null);
    const run = vi.fn();
    const action = withAction({ run });

    const result = await action(undefined);

    expect(result).toEqual({ ok: false, errorCode: 'UNAUTHENTICATED', fieldErrors: undefined });
    expect(run).not.toHaveBeenCalled();
  });

  it('returns NO_SHOP when the user has no confirmed membership', async () => {
    getShopMemberships.mockResolvedValue([]);
    const run = vi.fn();
    const action = withAction({ run });

    const result = await action(undefined);

    expect(result).toEqual({ ok: false, errorCode: 'NO_SHOP', fieldErrors: undefined });
    expect(run).not.toHaveBeenCalled();
  });
});

describe('withAction — role gate', () => {
  it('returns FORBIDDEN when the active-shop role is below minRole', async () => {
    getShopMemberships.mockResolvedValue([membership('barber')]);
    getCurrentShopId.mockResolvedValue(SHOP_A);
    const run = vi.fn();
    const action = withAction({ minRole: 'manager', run });

    const result = await action(undefined);

    expect(result).toEqual({ ok: false, errorCode: 'FORBIDDEN', fieldErrors: undefined });
    expect(run).not.toHaveBeenCalled();
  });

  it('resolves the role from the COOKIE shop, not memberships[0]', async () => {
    // Multi-shop user: owner in A, barber in B. Active cookie shop is B, so a
    // manager-gated action must be FORBIDDEN — the bug this gate fixes was
    // silently using shop A's owner role.
    getShopMemberships.mockResolvedValue([
      membership('owner', 'shop-a'),
      membership('barber', 'shop-b'),
    ]);
    getCurrentShopId.mockResolvedValue('shop-b');
    const run = vi.fn();
    const action = withAction({ minRole: 'manager', run });

    const result = await action(undefined);

    expect(result).toEqual({ ok: false, errorCode: 'FORBIDDEN', fieldErrors: undefined });
    expect(run).not.toHaveBeenCalled();
  });

  it('allows a role at or above minRole through to run', async () => {
    getShopMemberships.mockResolvedValue([membership('manager')]);
    const run = vi.fn().mockResolvedValue('done');
    const action = withAction({ minRole: 'manager', run });

    const result = await action(undefined);

    expect(result).toEqual({ ok: true, data: 'done' });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('withAction — input validation', () => {
  const schema = z.object({ name: z.string().min(1), age: z.number().int() });

  it('returns INVALID_INPUT with per-field errors on bad Zod input', async () => {
    const run = vi.fn();
    const action = withAction({ schema, run });

    const result = await action({ name: '', age: 1.5 });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errorCode).toBe('INVALID_INPUT');
    expect(result.fieldErrors).toBeDefined();
    expect(Object.keys(result.fieldErrors ?? {})).toEqual(expect.arrayContaining(['name', 'age']));
    expect(run).not.toHaveBeenCalled();
  });

  it('passes the parsed (typed) input to run on valid Zod input', async () => {
    const run = vi.fn().mockResolvedValue({ id: 'x' });
    const action = withAction({ schema, run });

    const result = await action({ name: 'Ada', age: 42 });

    expect(result).toEqual({ ok: true, data: { id: 'x' } });
    expect(run).toHaveBeenCalledWith(
      { name: 'Ada', age: 42 },
      expect.objectContaining({ userId: 'user-1', shopId: SHOP_A, role: 'owner' }),
    );
  });
});

describe('withAction — run failures & success', () => {
  it('returns UNEXPECTED and reports to observability when run throws', async () => {
    const boom = new Error('db exploded');
    const run = vi.fn().mockRejectedValue(boom);
    const action = withAction({ run });

    const result = await action(undefined);

    expect(result).toEqual({ ok: false, errorCode: 'UNEXPECTED', fieldErrors: undefined });
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(
      boom,
      expect.objectContaining({
        tags: { layer: 'server-action' },
        extra: expect.objectContaining({ userId: 'user-1', shopId: SHOP_A }),
      }),
    );
  });

  it('wraps a bare return value in ok()', async () => {
    const run = vi.fn().mockResolvedValue({ id: 'new-id' });
    const action = withAction({ run });

    const result = await action(undefined);

    expect(result).toEqual({ ok: true, data: { id: 'new-id' } });
  });

  it('passes a Result returned by run straight through', async () => {
    const run = vi.fn().mockResolvedValue({ ok: false, errorCode: 'NOT_FOUND' });
    const action = withAction({ run });

    const result = await action(undefined);

    expect(result).toEqual({ ok: false, errorCode: 'NOT_FOUND' });
  });

  it('populates ctx.barberId from getCurrentBarberId for a barber role', async () => {
    getShopMemberships.mockResolvedValue([membership('barber')]);
    getCurrentBarberId.mockResolvedValue('barber-row-9');
    const run = vi.fn().mockResolvedValue('ok');
    const action = withAction({ run });

    await action(undefined);

    expect(getCurrentBarberId).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ role: 'barber', barberId: 'barber-row-9' }),
    );
  });
});
