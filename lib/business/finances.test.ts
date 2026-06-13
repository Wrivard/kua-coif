import { describe, expect, it } from 'vitest';
import { excludeRefunded, forfeitedDeposits, netRevenue } from './finances';

describe('excludeRefunded', () => {
  it('drops only refunded appointments, keeps every other status', () => {
    const appts = [
      { payment_status: 'paid', total_amount: 50 },
      { payment_status: 'unpaid', total_amount: 30 },
      { payment_status: 'pending', total_amount: 20 },
      { payment_status: 'failed', total_amount: 10 },
      { payment_status: 'refunded', total_amount: 40 },
    ];
    const kept = excludeRefunded(appts);
    expect(kept).toHaveLength(4);
    expect(kept.some((a) => a.payment_status === 'refunded')).toBe(false);
  });

  it('returns an empty list unchanged', () => {
    expect(excludeRefunded([])).toEqual([]);
  });
});

describe('netRevenue', () => {
  it('excludes refunded appointments from the revenue total', () => {
    const appts = [
      { payment_status: 'paid', total_amount: 50 },
      { payment_status: 'unpaid', total_amount: 30 },
      { payment_status: 'refunded', total_amount: 40 }, // must NOT count
    ];
    // 50 + 30; the refunded 40 is netted out.
    expect(netRevenue(appts)).toBe(80);
  });

  it('a refunded appointment contributes 0 to a barber commission base', () => {
    // The per-barber commission base = netRevenue of that barber's appts. A
    // barber whose only appointment was refunded nets 0 → earns no commission.
    const barberAppts = [{ payment_status: 'refunded', total_amount: 100 }];
    expect(netRevenue(barberAppts)).toBe(0);
  });

  it('keeps paid/unpaid/pending/failed in the base', () => {
    const appts = [
      { payment_status: 'paid', total_amount: 10 },
      { payment_status: 'unpaid', total_amount: 10 },
      { payment_status: 'pending', total_amount: 10 },
      { payment_status: 'failed', total_amount: 10 },
    ];
    expect(netRevenue(appts)).toBe(40);
  });

  it('treats a null total_amount as 0', () => {
    expect(netRevenue([{ payment_status: 'paid', total_amount: null }])).toBe(0);
  });
});

describe('forfeitedDeposits', () => {
  it('sums kept deposits on no-shows that were paid online (in dollars)', () => {
    const appts = [
      { status: 'no_show', payment_status: 'paid', deposit_amount_cents: 2000 },
      { status: 'no_show', payment_status: 'paid', deposit_amount_cents: 500 },
    ];
    // (2000 + 500) cents = $25.
    expect(forfeitedDeposits(appts)).toBe(25);
  });

  it('excludes a refunded no-show (the deposit went back to the client)', () => {
    expect(
      forfeitedDeposits([
        { status: 'no_show', payment_status: 'refunded', deposit_amount_cents: 2000 },
      ]),
    ).toBe(0);
  });

  it('excludes an unpaid no-show (no money was ever captured)', () => {
    expect(
      forfeitedDeposits([
        { status: 'no_show', payment_status: 'unpaid', deposit_amount_cents: 2000 },
      ]),
    ).toBe(0);
  });

  it('excludes a completed paid appointment (a forfeit is a no-show only)', () => {
    expect(
      forfeitedDeposits([
        { status: 'completed', payment_status: 'paid', deposit_amount_cents: 2000 },
      ]),
    ).toBe(0);
  });

  it('excludes a no-show with no deposit charged', () => {
    expect(
      forfeitedDeposits([{ status: 'no_show', payment_status: 'paid', deposit_amount_cents: 0 }]),
    ).toBe(0);
  });

  it('returns 0 for an empty list', () => {
    expect(forfeitedDeposits([])).toBe(0);
  });
});
