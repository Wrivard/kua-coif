import { addDays, format, parse, startOfDay } from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';

/**
 * Timezone helpers for the calendar.
 *
 * Rule of thumb:
 *  - Everything in the DB is `timestamptz` (stored as UTC).
 *  - Everything we display is converted via the shop's timezone
 *    (e.g. `America/Toronto` for the Axum seed).
 *
 * Naming:
 *  - `toShopWallClock` — convert a UTC Date to a JS Date whose
 *    component values (getHours, getDate, …) reflect the wall-clock
 *    time *in the shop's timezone*. Useful for positioning on a
 *    visual calendar grid.
 *  - `shopWallClockToUtc` — opposite: take a wall-clock time the user
 *    typed (e.g. "10:30 in Toronto") and turn it into the UTC Date
 *    to store.
 *  - `formatShopTime` — render an instant in the shop's timezone.
 */

/** Convert a UTC instant to the shop's wall-clock Date. */
export function toShopWallClock(utc: Date | string, timezone: string): Date {
  const d = typeof utc === 'string' ? new Date(utc) : utc;
  return toZonedTime(d, timezone);
}

/** Convert a wall-clock Date (treated as local-to-shop) back to UTC. */
export function shopWallClockToUtc(local: Date, timezone: string): Date {
  return fromZonedTime(local, timezone);
}

/** Format an instant in the shop's timezone. */
export function formatShopTime(utc: Date | string, timezone: string, pattern: string): string {
  const d = typeof utc === 'string' ? new Date(utc) : utc;
  return formatInTimeZone(d, timezone, pattern);
}

/** Return the start-of-day instant in the shop's timezone, as a UTC Date. */
export function shopDayStart(date: Date, timezone: string): Date {
  // Take the wall-clock day, snap to 00:00, convert back to UTC.
  const wall = toZonedTime(date, timezone);
  const midnight = startOfDay(wall);
  return fromZonedTime(midnight, timezone);
}

/** End-of-day instant in the shop's timezone, as UTC. */
export function shopDayEnd(date: Date, timezone: string): Date {
  return new Date(shopDayStart(addDays(date, 1), timezone).getTime() - 1);
}

/**
 * Total minutes from midnight of the shop's wall-clock day.
 * Useful for positioning a block vertically on the calendar grid.
 */
export function minutesFromShopMidnight(utc: Date | string, timezone: string): number {
  const wall = toShopWallClock(utc, timezone);
  return wall.getHours() * 60 + wall.getMinutes();
}

/**
 * Combine a YYYY-MM-DD date + HH:mm string (in the shop's timezone) into a UTC Date.
 * Throws on invalid input.
 */
export function combineShopDateTime(
  date: string, // e.g. '2026-05-22'
  time: string, // e.g. '08:15'
  timezone: string,
): Date {
  const ref = parse(`${date} ${time}`, 'yyyy-MM-dd HH:mm', new Date());
  if (Number.isNaN(ref.getTime())) {
    throw new Error(`invalid date/time: "${date} ${time}"`);
  }
  return fromZonedTime(ref, timezone);
}

/**
 * Format an ISO date for display in the page header — e.g. "Fri May 22nd 2026".
 * Locale-aware: 'fr' uses "ven. 22 mai 2026", 'en' uses "Fri May 22nd 2026".
 */
export function formatHeaderDate(date: Date, locale: 'fr' | 'en', timezone: string) {
  if (locale === 'fr') return formatShopTime(date, timezone, 'EEE d MMM yyyy');
  return formatShopTime(date, timezone, 'EEE MMM do yyyy');
}

/** ISO YYYY-MM-DD of an instant, in the shop's timezone. */
export function shopIsoDate(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, 'yyyy-MM-dd');
}

/** Parse a YYYY-MM-DD into a UTC Date at start-of-day-in-tz.
 *  Runtime-TZ independent: the string is interpreted as a shop-local
 *  wall-clock date (NOT as runtime-local midnight — Vercel runs TZ=UTC). */
export function parseShopIsoDate(iso: string, timezone: string): Date {
  return combineShopDateTime(iso, '00:00', timezone);
}

/** Render minutes-from-midnight as "8:15a" / "11:35a" / "1:00p" style. */
export function formatSlotLabel(minutes: number, locale: 'fr' | 'en'): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (locale === 'fr') {
    return `${h}h${m === 0 ? '' : String(m).padStart(2, '0')}`;
  }
  const period = h < 12 ? 'a' : 'p';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')}${period}`;
}

// Re-exports for callers that want raw date-fns ops without re-importing.
export { addDays, format };
