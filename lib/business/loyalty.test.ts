import { beforeEach, describe, it, expect, vi } from 'vitest';
import { createSupabaseMock } from '@/lib/test/supabase-mock';

const h = vi.hoisted(() => ({
  captureException: vi.fn(),
  srClient: { current: null as unknown },
}));
vi.mock('@/lib/supabase/service-role', () => ({
  createSupabaseServiceRoleClient: () => h.srClient.current,
}));
vi.mock('@/lib/observability', () => ({
  captureException: (...a: unknown[]) => h.captureException(...a),
}));

import { computeLoyaltyProgress, awardLoyaltyOnCompletion } from './loyalty';

describe('computeLoyaltyProgress', () => {
  describe('transaction mode', () => {
    it('increments toward the goal without a reward', () => {
      expect(
        computeLoyaltyProgress({
          type: 'transaction',
          currentCounter: 2,
          goalCount: 4,
          rewardAmount: 5,
          totalAmount: 30,
        }),
      ).toEqual({ nextCounter: 3, goalReached: false, rewardCents: 0 });
    });

    it('grants the reward and resets the counter when the goal is reached', () => {
      expect(
        computeLoyaltyProgress({
          type: 'transaction',
          currentCounter: 3,
          goalCount: 4,
          rewardAmount: 5,
          totalAmount: 30,
        }),
      ).toEqual({ nextCounter: 0, goalReached: true, rewardCents: 500 });
    });
  });

  describe('value mode', () => {
    it('accumulates cents spent without a reward below the dollar goal', () => {
      expect(
        computeLoyaltyProgress({
          type: 'value',
          currentCounter: 0,
          goalCount: 100,
          rewardAmount: 10,
          totalAmount: 30,
        }),
      ).toEqual({ nextCounter: 3000, goalReached: false, rewardCents: 0 });
    });

    it('grants the reward exactly at the goal with no remainder', () => {
      // 70.00 banked + 30.00 spent = 100.00, goal 100.00
      expect(
        computeLoyaltyProgress({
          type: 'value',
          currentCounter: 7000,
          goalCount: 100,
          rewardAmount: 10,
          totalAmount: 30,
        }),
      ).toEqual({ nextCounter: 0, goalReached: true, rewardCents: 1000 });
    });

    it('carries the remainder past the goal so progress is not lost', () => {
      // 90.00 banked + 30.00 spent = 120.00, goal 100.00 -> reward + 20.00 carried
      expect(
        computeLoyaltyProgress({
          type: 'value',
          currentCounter: 9000,
          goalCount: 100,
          rewardAmount: 10,
          totalAmount: 30,
        }),
      ).toEqual({ nextCounter: 2000, goalReached: true, rewardCents: 1000 });
    });

    it('grants a single reward on a ticket that exceeds the goal and carries the rest', () => {
      // 0 banked + 250.00 spent, goal 100.00 -> one reward, 150.00 carried
      expect(
        computeLoyaltyProgress({
          type: 'value',
          currentCounter: 0,
          goalCount: 100,
          rewardAmount: 10,
          totalAmount: 250,
        }),
      ).toEqual({ nextCounter: 15000, goalReached: true, rewardCents: 1000 });
    });

    it('never rewards when the goal is zero', () => {
      expect(
        computeLoyaltyProgress({
          type: 'value',
          currentCounter: 0,
          goalCount: 0,
          rewardAmount: 10,
          totalAmount: 30,
        }),
      ).toEqual({ nextCounter: 3000, goalReached: false, rewardCents: 0 });
    });
  });
});

/**
 * SM-05 + SM-06 — `awardLoyaltyOnCompletion` resolves the config + gates on the
 * minimum amount in TS, then delegates the counter/balance write to the atomic,
 * idempotent `accrue_loyalty` RPC (migration 20260613160000). The RPC's SQL is
 * not executable by the fixture harness, so we assert the call shape + gating
 * (the same pattern services/actions.test.ts uses for set_service_taxes).
 */
function loyaltyConfig(over: Record<string, unknown> = {}) {
  return {
    shop_id: 'shop-1',
    enabled: true,
    type: 'transaction',
    goal_count: 4,
    min_transaction_amount: 0,
    reward_amount: 5,
    include_product_sales: false,
    include_tips: false,
    ...over,
  };
}

function stubRpc(fixtures: Record<string, Record<string, unknown>[]>) {
  const mock = createSupabaseMock(fixtures);
  const rpc = vi.fn().mockResolvedValue({ data: 0, error: null });
  (mock.client as { rpc: unknown }).rpc = (...a: unknown[]) => rpc(...a);
  h.srClient.current = mock.client;
  return rpc;
}

describe('awardLoyaltyOnCompletion (atomic + idempotent accrual)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.srClient.current = null;
  });

  it('calls accrue_loyalty with cents-normalized args when the program qualifies', async () => {
    const rpc = stubRpc({ loyalty_program: [loyaltyConfig()] });

    await awardLoyaltyOnCompletion({
      shopId: 'shop-1',
      appointmentId: 'appt-1',
      clientId: 'client-1',
      totalAmount: 30,
    });

    expect(rpc).toHaveBeenCalledWith('accrue_loyalty', {
      p_appointment_id: 'appt-1',
      p_client_id: 'client-1',
      p_type: 'transaction',
      p_goal_count: 4,
      p_reward_cents: 500,
      p_total_cents: 3000,
    });
  });

  it('does nothing when the loyalty program is disabled', async () => {
    const rpc = stubRpc({ loyalty_program: [loyaltyConfig({ enabled: false })] });

    await awardLoyaltyOnCompletion({
      shopId: 'shop-1',
      appointmentId: 'appt-1',
      clientId: 'client-1',
      totalAmount: 30,
    });

    expect(rpc).not.toHaveBeenCalled();
  });

  it('does nothing below the minimum transaction amount', async () => {
    const rpc = stubRpc({ loyalty_program: [loyaltyConfig({ min_transaction_amount: 50 })] });

    await awardLoyaltyOnCompletion({
      shopId: 'shop-1',
      appointmentId: 'appt-1',
      clientId: 'client-1',
      totalAmount: 30,
    });

    expect(rpc).not.toHaveBeenCalled();
  });
});
