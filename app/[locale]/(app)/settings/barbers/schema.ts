import { z } from 'zod';
import { BARBER_SETTINGS_SCOPES } from '@/db/enums';

/**
 * One row of the barber-settings dense grid (annexe Image 7).
 *
 * The "Shop" row has scope='shop' and barber_id=null. Per-barber overrides
 * use scope='barber' and a non-null barber_id. The DB enforces both via a
 * CHECK constraint + unique partial indexes (Phase 2 migration).
 */
export const barberSettingsRowSchema = z.object({
  scope: z.enum(BARBER_SETTINGS_SCOPES),
  barber_id: z.string().uuid().nullable(),
  allow_booking_wo_payment: z.boolean(),
  booking_tip: z.boolean(),
  confirmation_tip: z.boolean(),
  allow_multiple_services: z.boolean(),
  client_booking_interval_min: z.number().int().min(5).max(120),
  barber_booking_interval_min: z.number().int().min(5).max(120),
  days_book_in_advance: z.number().int().min(0).max(365),
  mins_book_before_appt: z
    .number()
    .int()
    .min(0)
    .max(48 * 60),
  customer_cancellations: z.boolean(),
  mins_cancel_before_appt: z
    .number()
    .int()
    .min(0)
    .max(48 * 60),
  reminder1_h: z.number().int().min(0).max(72),
  reminder1_m: z.number().int().min(0).max(59),
  reminder2_h: z.number().int().min(0).max(72),
  reminder2_m: z.number().int().min(0).max(59),
});
export type BarberSettingsRowInput = z.infer<typeof barberSettingsRowSchema>;

export const barberSettingsBatchSchema = z.object({
  rows: z.array(barberSettingsRowSchema).min(1),
});
export type BarberSettingsBatchInput = z.infer<typeof barberSettingsBatchSchema>;
