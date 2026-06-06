import { describe, it, expect } from 'vitest';
import { reconcileDecision } from './reconcile';

describe('reconcileDecision', () => {
  it('promotes a stuck pending row to paid when the intent succeeded', () => {
    expect(reconcileDecision({ current: 'pending', intentStatus: 'succeeded' })).toEqual({
      canonical: 'paid',
      changed: true,
    });
  });

  it('marks a pending row failed when the intent was canceled', () => {
    expect(reconcileDecision({ current: 'pending', intentStatus: 'canceled' })).toEqual({
      canonical: 'failed',
      changed: true,
    });
  });

  it('leaves a genuinely in-progress intent pending (no change)', () => {
    expect(reconcileDecision({ current: 'pending', intentStatus: 'processing' })).toEqual({
      canonical: 'pending',
      changed: false,
    });
  });

  it('leaves a never-confirmed intent pending (no change)', () => {
    expect(
      reconcileDecision({ current: 'pending', intentStatus: 'requires_payment_method' }),
    ).toEqual({ canonical: 'pending', changed: false });
  });

  it('is a no-op when the DB already matches a succeeded intent', () => {
    expect(reconcileDecision({ current: 'paid', intentStatus: 'succeeded' })).toEqual({
      canonical: 'paid',
      changed: false,
    });
  });
});
