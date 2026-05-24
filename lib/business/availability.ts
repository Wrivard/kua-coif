/**
 * Pure availability engine. Decides whether a candidate appointment slot
 * collides with anything (existing appointments, blocked time, shop hours,
 * days off, barber-specific rules).
 *
 * No Supabase, no React — the caller hydrates the inputs and we return a
 * verdict. This makes every business rule trivially Vitest-testable.
 *
 * Pricing-free design: we never decide whether a slot is allowed based on
 * money. That belongs to the booking-flow logic, not the engine.
 */

export type ShopHours = {
  /** 0=Sun … 6=Sat */
  weekday: number;
  enabled: boolean;
  /** "HH:mm" 24h shop-local */
  open_time: string | null;
  close_time: string | null;
};

export type ShopDayOff = {
  /** YYYY-MM-DD */
  date: string;
};

export type ExistingAppointment = {
  id: string;
  barber_id: string;
  start_at: Date;
  end_at: Date;
  /** Cancelled / no-show appointments don't count as conflicts. */
  status: 'booked' | 'confirmed' | 'arrived' | 'completed' | 'cancelled' | 'no_show';
};

export type BlockedTime = {
  /** Null = whole-shop block. */
  barber_id: string | null;
  start_at: Date;
  end_at: Date;
};

export type BarberSettings = {
  /** Min granularity between appointments visible to the client (booking page). */
  client_booking_interval_min: number;
  /** Days a client can book in advance. */
  days_book_in_advance: number;
  /** Minimum minutes before appointment start that a client may book. */
  mins_book_before_appt: number;
};

export type AvailabilityInput = {
  /** UTC instant — start of candidate slot. */
  start_at: Date;
  /** UTC instant — end of candidate slot. */
  end_at: Date;
  /** Barber for the candidate slot. */
  barber_id: string;
  /** YYYY-MM-DD shop-local date of the start_at. */
  shop_date: string;
  /** 0=Sun … 6=Sat shop-local weekday of start_at. */
  shop_weekday: number;
  /** "HH:mm" shop-local time of start_at. */
  shop_start_time: string;
  /** "HH:mm" shop-local time of end_at. */
  shop_end_time: string;

  hours: ReadonlyArray<ShopHours>;
  daysOff: ReadonlyArray<ShopDayOff>;
  existing: ReadonlyArray<ExistingAppointment>;
  blocked: ReadonlyArray<BlockedTime>;

  /** Used for booking-flow rules (e.g. mins_book_before_appt). Null = admin booking, those rules are skipped. */
  settings?: BarberSettings | null;
  /** When the booking attempt happens (UTC). Defaults to now. */
  now?: Date;
};

export type AvailabilityResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'SHOP_CLOSED'
        | 'DAY_OFF'
        | 'OUTSIDE_HOURS'
        | 'CONFLICT_APPOINTMENT'
        | 'CONFLICT_BLOCK'
        | 'TOO_LATE'
        | 'TOO_FAR_IN_ADVANCE'
        | 'NEGATIVE_DURATION';
    };

function timeToMinutes(t: string): number {
  const [hh, mm] = t.split(':').map((x) => Number(x));
  return (hh ?? 0) * 60 + (mm ?? 0);
}

/** Closed half-open range overlap: [aS, aE) intersects [bS, bE). */
function overlaps(aS: Date, aE: Date, bS: Date, bE: Date): boolean {
  return aS.getTime() < bE.getTime() && bS.getTime() < aE.getTime();
}

export function checkAvailability(input: AvailabilityInput): AvailabilityResult {
  if (input.end_at.getTime() <= input.start_at.getTime()) {
    return { ok: false, reason: 'NEGATIVE_DURATION' };
  }

  // 1. Day off?
  if (input.daysOff.some((d) => d.date === input.shop_date)) {
    return { ok: false, reason: 'DAY_OFF' };
  }

  // 2. Shop closed that weekday?
  const day = input.hours.find((h) => h.weekday === input.shop_weekday);
  if (!day || !day.enabled || !day.open_time || !day.close_time) {
    return { ok: false, reason: 'SHOP_CLOSED' };
  }

  // 3. Inside open/close window? Compare wall-clock minutes from midnight.
  const open = timeToMinutes(day.open_time);
  const close = timeToMinutes(day.close_time);
  const slotStart = timeToMinutes(input.shop_start_time);
  const slotEnd = timeToMinutes(input.shop_end_time);
  if (slotStart < open || slotEnd > close) {
    return { ok: false, reason: 'OUTSIDE_HOURS' };
  }

  // 4. Existing appointments for this barber (cancelled/no_show ignored).
  const liveStatuses = new Set(['booked', 'confirmed', 'arrived', 'completed']);
  for (const a of input.existing) {
    if (a.barber_id !== input.barber_id) continue;
    if (!liveStatuses.has(a.status)) continue;
    if (overlaps(input.start_at, input.end_at, a.start_at, a.end_at)) {
      return { ok: false, reason: 'CONFLICT_APPOINTMENT' };
    }
  }

  // 5. Blocked time: shop-wide blocks (barber_id null) hit everyone, otherwise
  //    only the matching barber.
  for (const b of input.blocked) {
    if (b.barber_id !== null && b.barber_id !== input.barber_id) continue;
    if (overlaps(input.start_at, input.end_at, b.start_at, b.end_at)) {
      return { ok: false, reason: 'CONFLICT_BLOCK' };
    }
  }

  // 6. Booking-flow time bounds (skipped when settings is null = admin mode).
  if (input.settings) {
    const now = input.now ?? new Date();
    const minMs = (input.settings.mins_book_before_appt ?? 0) * 60 * 1000;
    if (input.start_at.getTime() - now.getTime() < minMs) {
      return { ok: false, reason: 'TOO_LATE' };
    }
    const maxMs = (input.settings.days_book_in_advance ?? 365) * 24 * 60 * 60 * 1000;
    if (input.start_at.getTime() - now.getTime() > maxMs) {
      return { ok: false, reason: 'TOO_FAR_IN_ADVANCE' };
    }
  }

  return { ok: true };
}

/**
 * Cancellation rule: a client can cancel up to `mins_cancel_before_appt`
 * minutes before the appointment. Used both server-side and to enable/disable
 * client-side UI.
 */
export function canClientCancel(opts: {
  appointment_start_at: Date;
  customer_cancellations: boolean;
  mins_cancel_before_appt: number;
  now?: Date;
}): boolean {
  if (!opts.customer_cancellations) return false;
  const now = opts.now ?? new Date();
  const minutesLeft = (opts.appointment_start_at.getTime() - now.getTime()) / 60_000;
  return minutesLeft >= opts.mins_cancel_before_appt;
}
