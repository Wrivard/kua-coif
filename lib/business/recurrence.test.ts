import { describe, expect, it } from 'vitest';
import { enumerateRecurringDates } from './recurrence';

describe('enumerateRecurringDates', () => {
  it('returns [startIso] when recurrence is none', () => {
    expect(
      enumerateRecurringDates({ startIso: '2026-05-26', recurrence: 'none', untilIso: null }),
    ).toEqual(['2026-05-26']);
  });

  it('returns [] when recurrence is set but untilIso is missing', () => {
    expect(
      enumerateRecurringDates({ startIso: '2026-05-26', recurrence: 'weekly', untilIso: null }),
    ).toEqual([]);
  });

  it('returns [] when untilIso is before startIso', () => {
    expect(
      enumerateRecurringDates({
        startIso: '2026-05-26',
        recurrence: 'weekly',
        untilIso: '2026-05-19',
      }),
    ).toEqual([]);
  });

  it('enumerates weekly recurrences inclusive of start and end', () => {
    expect(
      enumerateRecurringDates({
        startIso: '2026-05-26',
        recurrence: 'weekly',
        untilIso: '2026-06-30',
      }),
    ).toEqual(['2026-05-26', '2026-06-02', '2026-06-09', '2026-06-16', '2026-06-23', '2026-06-30']);
  });

  it('enumerates biweekly recurrences', () => {
    expect(
      enumerateRecurringDates({
        startIso: '2026-05-26',
        recurrence: 'biweekly',
        untilIso: '2026-08-15',
      }),
    ).toEqual(['2026-05-26', '2026-06-09', '2026-06-23', '2026-07-07', '2026-07-21', '2026-08-04']);
  });

  it('enumerates monthly recurrences on the source day-of-month', () => {
    expect(
      enumerateRecurringDates({
        startIso: '2026-03-15',
        recurrence: 'monthly',
        untilIso: '2026-08-15',
      }),
    ).toEqual(['2026-03-15', '2026-04-15', '2026-05-15', '2026-06-15', '2026-07-15', '2026-08-15']);
  });

  it('monthly: handles short-month overflow (Jan 31 → Mar 3) without drift', () => {
    // 2027 is non-leap. Jan 31 + 1mo = Feb 31 which overflows to Mar 3.
    // The KEY invariant: the next occurrence (i=2) should reset off Jan 31
    // + 2 months = Mar 31, NOT chained off Mar 3.
    const result = enumerateRecurringDates({
      startIso: '2027-01-31',
      recurrence: 'monthly',
      untilIso: '2027-05-31',
    });
    expect(result).toEqual(['2027-01-31', '2027-03-03', '2027-03-31', '2027-05-01', '2027-05-31']);
  });

  it('caps at 53 occurrences regardless of the until window', () => {
    const result = enumerateRecurringDates({
      startIso: '2026-01-01',
      recurrence: 'weekly',
      untilIso: '2030-12-31', // 5 years out
    });
    expect(result.length).toBe(53);
    expect(result[0]).toBe('2026-01-01');
  });

  it('single-occurrence case when start == until on weekly', () => {
    expect(
      enumerateRecurringDates({
        startIso: '2026-05-26',
        recurrence: 'weekly',
        untilIso: '2026-05-26',
      }),
    ).toEqual(['2026-05-26']);
  });
});
