/**
 * Reminder scheduling — pure logic for the notifications cron (Barbers audit
 * B5). Honors the per-barber / shop-default reminder offsets (reminder1/2_h/m)
 * that the barber-settings grid persists, instead of the cron's previously
 * hardcoded 24h/1h windows.
 *
 * Pure + side-effect-free so it can be unit-tested without a DB or the email/
 * SMS pipeline. The cron resolves the inputs (upcoming appointments + the
 * effective offsets per barber) and feeds them here; this decides WHICH
 * (appointment, slot) reminders are due in the current tick. Sending +
 * idempotency stay in the cron.
 */

/** Effective reminder offsets for one barber/shop, in MINUTES before start. */
export type ReminderOffsets = {
  /** First reminder (legacy "reminder_24h" slot). 0 = disabled. */
  slot1Min: number;
  /** Second reminder (legacy "reminder_1h" slot). 0 = disabled. */
  slot2Min: number;
};

export type ReminderAppointment = {
  id: string;
  /** Appointment start, epoch ms (UTC). */
  startMs: number;
  /** barber_id, used to look up the effective offsets. */
  barberId: string;
};

export type DueReminder = { appointmentId: string; slot: 1 | 2 };

/** h + m → minutes. */
export function offsetMinutes(h: number, m: number): number {
  return h * 60 + m;
}

/** The largest offset the schema allows (reminder*_h max 72) — the cron uses
 *  this to bound how far ahead it must load appointments. */
export const MAX_REMINDER_OFFSET_MIN = 72 * 60;

/**
 * Which (appointment, slot) reminders fall due in this tick's window.
 *
 * A slot-N reminder for an appointment is due when its reminder time
 * (start − offsetN) lands within ±halfWindowMs of `nowMs` — the same 30-min
 * catch window the original cron used (±15 min around a 15-min schedule), so
 * the per-tick `notification_sends` idempotency ledger still fires each
 * reminder exactly once across overlapping ticks. An offset of 0 disables that
 * slot. The effective offsets are the barber's override, else the shop default.
 */
export function dueReminders(
  appts: ReminderAppointment[],
  offsetsByBarber: Map<string, ReminderOffsets>,
  shopDefault: ReminderOffsets,
  nowMs: number,
  halfWindowMs: number,
): DueReminder[] {
  const out: DueReminder[] = [];
  for (const a of appts) {
    const off = offsetsByBarber.get(a.barberId) ?? shopDefault;
    const slots: Array<[1 | 2, number]> = [
      [1, off.slot1Min],
      [2, off.slot2Min],
    ];
    for (const [slot, offMin] of slots) {
      if (offMin <= 0) continue; // 0 = disabled
      const reminderMs = a.startMs - offMin * 60_000;
      if (reminderMs >= nowMs - halfWindowMs && reminderMs <= nowMs + halfWindowMs) {
        out.push({ appointmentId: a.id, slot });
      }
    }
  }
  return out;
}
