import { describe, expect, it } from 'vitest';
import {
  dueReminders,
  offsetMinutes,
  type ReminderAppointment,
  type ReminderOffsets,
} from './reminders';

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = 1_700_000_000_000; // fixed epoch ms — deterministic
const HALF = 15 * MIN; // ±15 min catch window (matches the 15-min cron schedule)

const SHOP: ReminderOffsets = { slot1Min: 24 * 60, slot2Min: 60 }; // 24h / 1h defaults

function appt(id: string, startMs: number, barberId = 'b1'): ReminderAppointment {
  return { id, startMs, barberId };
}

describe('offsetMinutes', () => {
  it('converts h+m to minutes', () => {
    expect(offsetMinutes(24, 0)).toBe(1440);
    expect(offsetMinutes(1, 30)).toBe(90);
    expect(offsetMinutes(0, 0)).toBe(0);
  });
});

describe('dueReminders', () => {
  it('fires slot 1 exactly at start − 24h (shop default)', () => {
    const a = appt('a', NOW + 24 * HOUR); // reminder time === NOW
    expect(dueReminders([a], new Map(), SHOP, NOW, HALF)).toEqual([
      { appointmentId: 'a', slot: 1 },
    ]);
  });

  it('fires slot 2 exactly at start − 1h', () => {
    const a = appt('a', NOW + 1 * HOUR);
    expect(dueReminders([a], new Map(), SHOP, NOW, HALF)).toEqual([
      { appointmentId: 'a', slot: 2 },
    ]);
  });

  it('honors a per-barber override (48h) instead of the shop 24h default', () => {
    const offsets = new Map([['b1', { slot1Min: 48 * 60, slot2Min: 30 }]]);
    const a = appt('a', NOW + 48 * HOUR); // 48h before === NOW → slot1 due
    expect(dueReminders([a], offsets, SHOP, NOW, HALF)).toEqual([{ appointmentId: 'a', slot: 1 }]);
    // the shop's 24h-before reminder must NOT fire for this barber
    const b = appt('b', NOW + 24 * HOUR);
    expect(dueReminders([b], offsets, SHOP, NOW, HALF)).toEqual([]);
  });

  it('treats an offset of 0 as disabled', () => {
    const offsets = new Map([['b1', { slot1Min: 0, slot2Min: 0 }]]);
    const a = appt('a', NOW + 24 * HOUR);
    expect(dueReminders([a], offsets, SHOP, NOW, HALF)).toEqual([]);
  });

  it('includes the ±halfWindow boundaries and excludes just outside', () => {
    // reminder time = NOW + HALF → start = NOW + 24h + HALF (slot1)
    const inside = appt('in', NOW + 24 * HOUR + HALF);
    expect(dueReminders([inside], new Map(), SHOP, NOW, HALF)).toEqual([
      { appointmentId: 'in', slot: 1 },
    ]);
    const outside = appt('out', NOW + 24 * HOUR + HALF + 1);
    expect(dueReminders([outside], new Map(), SHOP, NOW, HALF)).toEqual([]);
  });

  it('does not fire when both reminders are still in the future', () => {
    const a = appt('a', NOW + 50 * HOUR); // the 24h reminder is ~26h away
    expect(dueReminders([a], new Map(), SHOP, NOW, HALF)).toEqual([]);
  });

  it('returns both slots across a set of appointments', () => {
    const a = appt('a', NOW + 24 * HOUR); // slot1 due
    const b = appt('b', NOW + 1 * HOUR); // slot2 due
    const out = dueReminders([a, b], new Map(), SHOP, NOW, HALF);
    expect(out).toContainEqual({ appointmentId: 'a', slot: 1 });
    expect(out).toContainEqual({ appointmentId: 'b', slot: 2 });
    expect(out).toHaveLength(2);
  });

  it('falls back to the shop default when a barber has no override row', () => {
    const offsets = new Map([['other', { slot1Min: 48 * 60, slot2Min: 30 }]]);
    const a = appt('a', NOW + 24 * HOUR, 'b1'); // b1 has no override → shop 24h
    expect(dueReminders([a], offsets, SHOP, NOW, HALF)).toEqual([{ appointmentId: 'a', slot: 1 }]);
  });
});
