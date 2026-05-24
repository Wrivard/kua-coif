import { describe, expect, it } from 'vitest';
import {
  canClientCancel,
  checkAvailability,
  type AvailabilityInput,
  type ShopHours,
} from './availability';

const TUE_OPEN: ShopHours = { weekday: 2, enabled: true, open_time: '10:00', close_time: '19:00' };
const MON_CLOSED: ShopHours = { weekday: 1, enabled: false, open_time: null, close_time: null };
const HOURS: ShopHours[] = [
  MON_CLOSED,
  TUE_OPEN,
  { weekday: 3, enabled: true, open_time: '10:00', close_time: '19:00' },
  { weekday: 4, enabled: true, open_time: '10:00', close_time: '20:00' },
  { weekday: 5, enabled: true, open_time: '10:00', close_time: '20:00' },
  { weekday: 6, enabled: true, open_time: '10:00', close_time: '17:00' },
];

const baseInput: AvailabilityInput = {
  start_at: new Date('2026-05-26T14:00:00.000Z'), // Tue 10am EDT
  end_at: new Date('2026-05-26T14:30:00.000Z'),
  barber_id: 'B1',
  shop_date: '2026-05-26',
  shop_weekday: 2,
  shop_start_time: '10:00',
  shop_end_time: '10:30',
  hours: HOURS,
  daysOff: [],
  existing: [],
  blocked: [],
  settings: null, // admin mode, no booking-flow constraints
};

describe('checkAvailability', () => {
  it('accepts a free slot inside shop hours', () => {
    expect(checkAvailability(baseInput)).toEqual({ ok: true });
  });

  it('rejects when end_at <= start_at', () => {
    expect(checkAvailability({ ...baseInput, end_at: baseInput.start_at })).toEqual({
      ok: false,
      reason: 'NEGATIVE_DURATION',
    });
  });

  it('rejects when shop is closed that weekday', () => {
    expect(checkAvailability({ ...baseInput, shop_weekday: 1 })).toEqual({
      ok: false,
      reason: 'SHOP_CLOSED',
    });
  });

  it('rejects when date is in daysOff', () => {
    expect(checkAvailability({ ...baseInput, daysOff: [{ date: '2026-05-26' }] })).toEqual({
      ok: false,
      reason: 'DAY_OFF',
    });
  });

  it('rejects slots that start before opening', () => {
    expect(
      checkAvailability({
        ...baseInput,
        shop_start_time: '09:00',
        shop_end_time: '09:30',
      }),
    ).toEqual({ ok: false, reason: 'OUTSIDE_HOURS' });
  });

  it('rejects slots that end after closing', () => {
    expect(
      checkAvailability({
        ...baseInput,
        shop_start_time: '18:45',
        shop_end_time: '19:15',
      }),
    ).toEqual({ ok: false, reason: 'OUTSIDE_HOURS' });
  });

  it('detects conflict with same-barber confirmed appointment', () => {
    const result = checkAvailability({
      ...baseInput,
      existing: [
        {
          id: 'A1',
          barber_id: 'B1',
          start_at: new Date('2026-05-26T14:15:00.000Z'),
          end_at: new Date('2026-05-26T14:45:00.000Z'),
          status: 'confirmed',
        },
      ],
    });
    expect(result).toEqual({ ok: false, reason: 'CONFLICT_APPOINTMENT' });
  });

  it('ignores cancelled appointments (they free the slot)', () => {
    const result = checkAvailability({
      ...baseInput,
      existing: [
        {
          id: 'A1',
          barber_id: 'B1',
          start_at: new Date('2026-05-26T14:00:00.000Z'),
          end_at: new Date('2026-05-26T14:30:00.000Z'),
          status: 'cancelled',
        },
      ],
    });
    expect(result).toEqual({ ok: true });
  });

  it('ignores conflicts on a different barber', () => {
    const result = checkAvailability({
      ...baseInput,
      existing: [
        {
          id: 'A1',
          barber_id: 'OTHER',
          start_at: new Date('2026-05-26T14:00:00.000Z'),
          end_at: new Date('2026-05-26T14:30:00.000Z'),
          status: 'confirmed',
        },
      ],
    });
    expect(result).toEqual({ ok: true });
  });

  it('detects conflict with blocked time (barber-specific)', () => {
    const result = checkAvailability({
      ...baseInput,
      blocked: [
        {
          barber_id: 'B1',
          start_at: new Date('2026-05-26T13:45:00.000Z'),
          end_at: new Date('2026-05-26T14:15:00.000Z'),
        },
      ],
    });
    expect(result).toEqual({ ok: false, reason: 'CONFLICT_BLOCK' });
  });

  it('detects conflict with shop-wide blocked time (barber_id null)', () => {
    const result = checkAvailability({
      ...baseInput,
      blocked: [
        {
          barber_id: null,
          start_at: new Date('2026-05-26T14:00:00.000Z'),
          end_at: new Date('2026-05-26T15:00:00.000Z'),
        },
      ],
    });
    expect(result).toEqual({ ok: false, reason: 'CONFLICT_BLOCK' });
  });

  it('enforces mins_book_before_appt for client bookings', () => {
    const now = new Date('2026-05-26T13:58:00.000Z'); // 2 minutes before 10am EDT
    const result = checkAvailability({
      ...baseInput,
      settings: {
        client_booking_interval_min: 30,
        days_book_in_advance: 30,
        mins_book_before_appt: 5,
      },
      now,
    });
    expect(result).toEqual({ ok: false, reason: 'TOO_LATE' });
  });

  it('enforces days_book_in_advance for client bookings', () => {
    const result = checkAvailability({
      ...baseInput,
      start_at: new Date('2027-05-26T14:00:00.000Z'), // 1 year out
      end_at: new Date('2027-05-26T14:30:00.000Z'),
      shop_date: '2027-05-26',
      settings: {
        client_booking_interval_min: 30,
        days_book_in_advance: 30,
        mins_book_before_appt: 5,
      },
      now: new Date('2026-05-26T13:00:00.000Z'),
    });
    expect(result).toEqual({ ok: false, reason: 'TOO_FAR_IN_ADVANCE' });
  });
});

describe('canClientCancel', () => {
  const apptStart = new Date('2026-05-26T14:00:00.000Z');

  it('returns false when customer_cancellations is off', () => {
    expect(
      canClientCancel({
        appointment_start_at: apptStart,
        customer_cancellations: false,
        mins_cancel_before_appt: 300,
        now: new Date('2026-05-26T08:00:00.000Z'),
      }),
    ).toBe(false);
  });

  it('returns true when window is wide enough', () => {
    expect(
      canClientCancel({
        appointment_start_at: apptStart,
        customer_cancellations: true,
        mins_cancel_before_appt: 60, // 1h before
        now: new Date('2026-05-26T12:00:00.000Z'), // 2h before
      }),
    ).toBe(true);
  });

  it('returns false when inside the no-cancel window', () => {
    expect(
      canClientCancel({
        appointment_start_at: apptStart,
        customer_cancellations: true,
        mins_cancel_before_appt: 60,
        now: new Date('2026-05-26T13:30:00.000Z'), // only 30 min before
      }),
    ).toBe(false);
  });
});
