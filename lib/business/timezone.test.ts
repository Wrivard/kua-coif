import { describe, expect, it } from 'vitest';
import { combineShopDateTime, formatShopTime, shopDayStart, shopDayEnd } from './timezone';

/**
 * DST correctness for the calendar's timezone helpers (America/Toronto, the
 * Axum seed shop). The availability engine is unit-tested elsewhere, but it
 * consumes pre-derived wall-clock instants — the real DST risk lives in these
 * UTC↔wall-clock conversions. These tests pin the behavior across both 2026
 * transitions: spring-forward (Sun Mar 8, 02:00→03:00) and fall-back
 * (Sun Nov 1, 02:00→01:00).
 */

const TZ = 'America/Toronto';
const HOUR = 60 * 60 * 1000;

describe('timezone helpers — DST (America/Toronto)', () => {
  it('formatShopTime renders the right wall clock in summer (EDT) and winter (EST)', () => {
    // 12:15 UTC → 08:15 EDT (UTC-4) in May.
    expect(formatShopTime('2026-05-22T12:15:00Z', TZ, 'HH:mm')).toBe('08:15');
    // 13:15 UTC → 08:15 EST (UTC-5) in January.
    expect(formatShopTime('2026-01-15T13:15:00Z', TZ, 'HH:mm')).toBe('08:15');
  });

  it('combineShopDateTime → UTC respects the seasonal offset', () => {
    // 08:15 EDT (May) = 12:15 UTC.
    expect(combineShopDateTime('2026-05-22', '08:15', TZ).toISOString()).toBe(
      '2026-05-22T12:15:00.000Z',
    );
    // 08:15 EST (January) = 13:15 UTC.
    expect(combineShopDateTime('2026-01-15', '08:15', TZ).toISOString()).toBe(
      '2026-01-15T13:15:00.000Z',
    );
  });

  it('round-trips combine → format within the shop tz (incl. winter + late evening)', () => {
    for (const [date, time] of [
      ['2026-05-22', '08:15'],
      ['2026-01-15', '08:15'],
      ['2026-07-04', '23:45'],
    ] as const) {
      const utc = combineShopDateTime(date, time, TZ);
      expect(formatShopTime(utc, TZ, 'yyyy-MM-dd HH:mm')).toBe(`${date} ${time}`);
    }
  });

  it('the spring-forward day is 23h and the fall-back day is 25h', () => {
    // 2026-03-08: clocks jump 02:00 → 03:00 (EST→EDT) → a 23-hour day.
    const springLen =
      shopDayStart(new Date('2026-03-09T12:00:00Z'), TZ).getTime() -
      shopDayStart(new Date('2026-03-08T12:00:00Z'), TZ).getTime();
    expect(springLen).toBe(23 * HOUR);

    // 2026-11-01: clocks fall 02:00 → 01:00 (EDT→EST) → a 25-hour day.
    const fallLen =
      shopDayStart(new Date('2026-11-02T12:00:00Z'), TZ).getTime() -
      shopDayStart(new Date('2026-11-01T12:00:00Z'), TZ).getTime();
    expect(fallLen).toBe(25 * HOUR);
  });

  it('appointment duration is instant-based across the spring-forward gap', () => {
    // 01:30 EST on the spring-forward day + 60 min. The wall clock skips
    // 02:00→03:00, so the instant 60 min later displays as 03:30 EDT — NOT the
    // non-existent 02:30. Proves end = start + durationMs stays correct.
    const start = combineShopDateTime('2026-03-08', '01:30', TZ); // 06:30 UTC (EST)
    const end = new Date(start.getTime() + HOUR); // +60 min → 07:30 UTC
    expect(formatShopTime(end, TZ, 'HH:mm')).toBe('03:30');
  });

  it('shopDayEnd is exactly 1ms before the next day start', () => {
    const end = shopDayEnd(new Date('2026-05-22T12:00:00Z'), TZ);
    const nextStart = shopDayStart(new Date('2026-05-23T12:00:00Z'), TZ);
    expect(nextStart.getTime() - end.getTime()).toBe(1);
  });
});
