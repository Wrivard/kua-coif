import { describe, it, expect } from 'vitest';
import { computeLoyaltyProgress } from './loyalty';

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
