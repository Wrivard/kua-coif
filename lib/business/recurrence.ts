/**
 * Loop 27 — recurrence enumeration for blocked-time and (eventually)
 * recurring appointments. Pure date math, no timezone concerns: the
 * caller pairs each YYYY-MM-DD with a fixed start/end time-of-day.
 *
 *  - `none` → single-element list of the start date.
 *  - `weekly` / `biweekly` → step by 7 / 14 days from the start.
 *  - `monthly` → i-th occurrence = (startYear, startMonth + i, startDay).
 *    Month-arithmetic on Date.UTC overflows short months naturally
 *    (Jan 31 + 1 month → Mar 3 in a non-leap year). We accept the
 *    overflow occurrence rather than skipping — same behaviour as
 *    iCal RRULE BYMONTHDAY with no BYSETPOS. Crucially each
 *    occurrence is computed independently from the start (NOT chained
 *    off the previous cursor) so a Feb-30-drift on month i doesn't
 *    contaminate month i+1.
 *
 * Hard cap of 53 occurrences (one year of weekly) bounds the payload.
 * Returns [] when recurrence is set but untilIso is missing or before
 * start — callers surface INVALID_INPUT in that case.
 */
export type Recurrence = 'none' | 'weekly' | 'biweekly' | 'monthly';

export function enumerateRecurringDates(args: {
  startIso: string;
  recurrence: Recurrence;
  untilIso: string | null;
}): string[] {
  if (args.recurrence === 'none') return [args.startIso];
  if (!args.untilIso) return [];

  const startParts = args.startIso.split('-').map(Number);
  const untilParts = args.untilIso.split('-').map(Number);
  if (startParts.length !== 3 || untilParts.length !== 3) return [];
  const [sy, sm, sd] = startParts as [number, number, number];
  const [uy, um, ud] = untilParts as [number, number, number];

  const startUtc = Date.UTC(sy, sm - 1, sd);
  const untilUtc = Date.UTC(uy, um - 1, ud);
  if (untilUtc < startUtc) return [];

  const out: string[] = [];
  const cap = 53;
  const fmt = (d: Date): string =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
      d.getUTCDate(),
    ).padStart(2, '0')}`;

  if (args.recurrence === 'monthly') {
    for (let i = 0; i < cap; i++) {
      // Re-derive from the start month each iteration so an overflow
      // on one occurrence (Jan 31 + 1mo → Mar 3) doesn't poison the
      // base for the next.
      const occ = new Date(Date.UTC(sy, sm - 1 + i, sd));
      if (occ.getTime() > untilUtc) break;
      out.push(fmt(occ));
    }
    return out;
  }

  // weekly / biweekly — step in days from the start.
  const stepDays = args.recurrence === 'weekly' ? 7 : 14;
  const cursor = new Date(startUtc);
  while (cursor.getTime() <= untilUtc && out.length < cap) {
    out.push(fmt(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + stepDays);
  }
  return out;
}
