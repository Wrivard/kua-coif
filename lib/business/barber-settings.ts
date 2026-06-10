/**
 * Effective barber-settings resolver (B20) — ONE tested function replacing the
 * seven copy-pasted `override-row ?? shop-row ?? fallback` resolutions that had
 * drifted apart (booking, slots, reschedule, /me self-cancel, admin cancel, the
 * reminders cron, and the settings editor's draft template).
 *
 * Pure + side-effect-free (NO supabase import): each consumer runs its own
 * narrow query, then hands the rows here and reads the resolved policy. New
 * consumers of barber_settings MUST go through this resolver.
 *
 * PINNED semantics (deviations are bugs — see lib/business/barber-settings.test.ts):
 *  - ROW-LEVEL precedence: the matching per-barber override row replaces the
 *    shop row wholesale; there is NO field-level merge between the two rows.
 *  - A chosen row whose column is null/absent (legacy rows, or a narrow query
 *    that didn't select it) falls back FIELD-WISE to BARBER_SETTINGS_DEFAULTS.
 *    This reproduces the old `customer_cancellations !== false` (null ⇒ allow)
 *    and `mins_cancel_before_appt ?? 0` semantics exactly.
 *  - No rows at all ⇒ BARBER_SETTINGS_DEFAULTS. The deliberate behavior
 *    ALIGNMENT (B20): a shop with no settings rows now gets the documented
 *    defaults instead of `null` (which made the availability engine skip the
 *    interval / days-in-advance / mins-before constraints on booking/reschedule).
 */

/**
 * Loose input shape: scope + barber_id identify the row; every policy column is
 * optional + nullable so a narrow `select(...)` (only the columns a given site
 * consumes) type-checks without widening that site's query.
 */
export type BarberSettingsRow = {
  scope: 'shop' | 'barber';
  barber_id: string | null;
  allow_booking_wo_payment?: boolean | null;
  booking_tip?: boolean | null;
  confirmation_tip?: boolean | null;
  allow_multiple_services?: boolean | null;
  client_booking_interval_min?: number | null;
  barber_booking_interval_min?: number | null;
  days_book_in_advance?: number | null;
  mins_book_before_appt?: number | null;
  customer_cancellations?: boolean | null;
  mins_cancel_before_appt?: number | null;
  reminder1_h?: number | null;
  reminder1_m?: number | null;
  reminder2_h?: number | null;
  reminder2_m?: number | null;
};

/** Fully-resolved policy: every consumed field, non-nullable. */
export type EffectiveBarberSettings = {
  allow_booking_wo_payment: boolean;
  booking_tip: boolean;
  confirmation_tip: boolean;
  allow_multiple_services: boolean;
  client_booking_interval_min: number;
  barber_booking_interval_min: number;
  days_book_in_advance: number;
  mins_book_before_appt: number;
  customer_cancellations: boolean;
  mins_cancel_before_appt: number;
  reminder1_h: number;
  reminder1_m: number;
  reminder2_h: number;
  reminder2_m: number;
};

/**
 * The documented defaults. Mirrors the barber-settings editor's `DEFAULTS`
 * template (the seed annexe is the source) EXCEPT `mins_cancel_before_appt`,
 * which is `0` here = the RUNTIME "no cancellation policy" fallback the cancel
 * paths have always used (`mins_cancel_before_appt ?? 0`). The editor's NEW-row
 * template keeps its seed value (5h) by overriding this one field — drafting a
 * row is a different concern from resolving effective runtime policy.
 */
export const BARBER_SETTINGS_DEFAULTS: EffectiveBarberSettings = {
  allow_booking_wo_payment: true,
  booking_tip: true,
  confirmation_tip: false,
  allow_multiple_services: true,
  client_booking_interval_min: 30,
  barber_booking_interval_min: 15,
  days_book_in_advance: 30,
  mins_book_before_appt: 5,
  customer_cancellations: true,
  mins_cancel_before_appt: 0,
  reminder1_h: 24,
  reminder1_m: 0,
  reminder2_h: 1,
  reminder2_m: 0,
};

/**
 * Resolve the effective settings for a barber within ONE shop's rows.
 *
 * @param rows     barber_settings rows for a single shop (any mix of the shop
 *                 row + per-barber override rows; extra columns ignored).
 * @param barberId the barber whose policy we want, or null for "any barber"
 *                 (public any-barber booking) ⇒ the shop row.
 */
export function resolveEffectiveBarberSettings(
  rows: ReadonlyArray<BarberSettingsRow>,
  barberId: string | null,
): EffectiveBarberSettings {
  const override =
    barberId != null
      ? rows.find((r) => r.scope === 'barber' && r.barber_id === barberId)
      : undefined;
  const shop = rows.find((r) => r.scope === 'shop');
  const chosen = override ?? shop;
  if (!chosen) return { ...BARBER_SETTINGS_DEFAULTS };

  const D = BARBER_SETTINGS_DEFAULTS;
  return {
    allow_booking_wo_payment: chosen.allow_booking_wo_payment ?? D.allow_booking_wo_payment,
    booking_tip: chosen.booking_tip ?? D.booking_tip,
    confirmation_tip: chosen.confirmation_tip ?? D.confirmation_tip,
    allow_multiple_services: chosen.allow_multiple_services ?? D.allow_multiple_services,
    client_booking_interval_min:
      chosen.client_booking_interval_min ?? D.client_booking_interval_min,
    barber_booking_interval_min:
      chosen.barber_booking_interval_min ?? D.barber_booking_interval_min,
    days_book_in_advance: chosen.days_book_in_advance ?? D.days_book_in_advance,
    mins_book_before_appt: chosen.mins_book_before_appt ?? D.mins_book_before_appt,
    customer_cancellations: chosen.customer_cancellations ?? D.customer_cancellations,
    mins_cancel_before_appt: chosen.mins_cancel_before_appt ?? D.mins_cancel_before_appt,
    reminder1_h: chosen.reminder1_h ?? D.reminder1_h,
    reminder1_m: chosen.reminder1_m ?? D.reminder1_m,
    reminder2_h: chosen.reminder2_h ?? D.reminder2_h,
    reminder2_m: chosen.reminder2_m ?? D.reminder2_m,
  };
}
