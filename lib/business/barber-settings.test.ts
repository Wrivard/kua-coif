import { describe, expect, it } from 'vitest';
import {
  BARBER_SETTINGS_DEFAULTS,
  resolveEffectiveBarberSettings,
  type BarberSettingsRow,
} from './barber-settings';
import { offsetMinutes } from './reminders';

/**
 * Pins the B20 effective-barber-settings resolution. These semantics are the
 * unified contract the 7 sites now share; any deviation is a behavior bug.
 */

const BARBER = 'barber-1';
const OTHER = 'barber-2';

function shopRow(over: Partial<BarberSettingsRow> = {}): BarberSettingsRow {
  return {
    scope: 'shop',
    barber_id: null,
    client_booking_interval_min: 20,
    barber_booking_interval_min: 10,
    days_book_in_advance: 14,
    mins_book_before_appt: 60,
    customer_cancellations: true,
    mins_cancel_before_appt: 300,
    allow_multiple_services: true,
    reminder1_h: 48,
    reminder1_m: 0,
    reminder2_h: 2,
    reminder2_m: 0,
    ...over,
  };
}

function barberRow(over: Partial<BarberSettingsRow> = {}): BarberSettingsRow {
  return { ...shopRow(), scope: 'barber', barber_id: BARBER, ...over };
}

describe('resolveEffectiveBarberSettings', () => {
  it('override row beats the shop row (ROW-LEVEL precedence)', () => {
    const rows = [
      shopRow({ client_booking_interval_min: 20 }),
      barberRow({ client_booking_interval_min: 45, mins_cancel_before_appt: 120 }),
    ];
    const eff = resolveEffectiveBarberSettings(rows, BARBER);
    expect(eff.client_booking_interval_min).toBe(45);
    expect(eff.mins_cancel_before_appt).toBe(120);
  });

  it('falls back to the shop row when the barber has no override', () => {
    const rows = [shopRow({ client_booking_interval_min: 20 }), barberRow({ barber_id: OTHER })];
    const eff = resolveEffectiveBarberSettings(rows, BARBER);
    expect(eff.client_booking_interval_min).toBe(20);
  });

  it('returns BARBER_SETTINGS_DEFAULTS when there are no rows at all', () => {
    expect(resolveEffectiveBarberSettings([], BARBER)).toEqual(BARBER_SETTINGS_DEFAULTS);
    // The B20 alignment: no rows ⇒ documented defaults (interval 30, days 30,
    // mins-before 5), NOT "no constraints".
    expect(resolveEffectiveBarberSettings([], null).client_booking_interval_min).toBe(30);
    expect(resolveEffectiveBarberSettings([], null).days_book_in_advance).toBe(30);
    expect(resolveEffectiveBarberSettings([], null).mins_book_before_appt).toBe(5);
  });

  it('a null column on the chosen row falls back FIELD-WISE to defaults', () => {
    // Legacy row with customer_cancellations unset ⇒ default true
    // (reproduces the old `customer_cancellations !== false`).
    const rows = [shopRow({ customer_cancellations: null, mins_cancel_before_appt: null })];
    const eff = resolveEffectiveBarberSettings(rows, null);
    expect(eff.customer_cancellations).toBe(true);
    expect(eff.mins_cancel_before_appt).toBe(0); // default = "no policy"
    // …but the other (non-null) columns on that same row still win.
    expect(eff.client_booking_interval_min).toBe(20);
  });

  it('an EXPLICIT false on customer_cancellations is preserved (not defaulted to true)', () => {
    const eff = resolveEffectiveBarberSettings([shopRow({ customer_cancellations: false })], null);
    expect(eff.customer_cancellations).toBe(false);
  });

  it('barberId null (any-barber booking) resolves to the shop row', () => {
    const rows = [
      shopRow({ client_booking_interval_min: 25 }),
      barberRow({ client_booking_interval_min: 99 }),
    ];
    const eff = resolveEffectiveBarberSettings(rows, null);
    expect(eff.client_booking_interval_min).toBe(25);
  });

  it('reminder offsets equal the cron override→shop→default behavior', () => {
    const rows = [
      shopRow(),
      barberRow({ reminder1_h: 12, reminder1_m: 30, reminder2_h: 0, reminder2_m: 45 }),
    ];
    // Override present → barber offsets.
    const eff = resolveEffectiveBarberSettings(rows, BARBER);
    expect(offsetMinutes(eff.reminder1_h, eff.reminder1_m)).toBe(12 * 60 + 30);
    expect(offsetMinutes(eff.reminder2_h, eff.reminder2_m)).toBe(45);
    // No override for OTHER → shop offsets (48h / 2h).
    const effShop = resolveEffectiveBarberSettings(rows, OTHER);
    expect(offsetMinutes(effShop.reminder1_h, effShop.reminder1_m)).toBe(48 * 60);
    // No rows → default offsets (24h / 1h), matching the cron's old FALLBACK.
    const effDef = resolveEffectiveBarberSettings([], BARBER);
    expect(offsetMinutes(effDef.reminder1_h, effDef.reminder1_m)).toBe(24 * 60);
    expect(offsetMinutes(effDef.reminder2_h, effDef.reminder2_m)).toBe(60);
  });

  it('mins_cancel_before_appt default is 0 ("no policy")', () => {
    expect(BARBER_SETTINGS_DEFAULTS.mins_cancel_before_appt).toBe(0);
    expect(resolveEffectiveBarberSettings([], BARBER).mins_cancel_before_appt).toBe(0);
  });

  it('with multiple barber override rows, only the matching barber_id is picked', () => {
    const rows = [
      shopRow(),
      barberRow({ barber_id: OTHER, client_booking_interval_min: 5 }),
      barberRow({ barber_id: BARBER, client_booking_interval_min: 60 }),
    ];
    expect(resolveEffectiveBarberSettings(rows, BARBER).client_booking_interval_min).toBe(60);
    expect(resolveEffectiveBarberSettings(rows, OTHER).client_booking_interval_min).toBe(5);
  });
});
