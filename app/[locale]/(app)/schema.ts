import { z } from 'zod';
import { APPOINTMENT_STATUSES } from '@/db/enums';

export const appointmentSchema = z.object({
  barber_id: z.string().uuid(),
  client_id: z.string().uuid(),
  /** YYYY-MM-DD (shop-local). */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'INVALID_DATE'),
  /** HH:mm (shop-local). */
  start_time: z.string().regex(/^\d{2}:\d{2}$/, 'INVALID_TIME'),
  /** One or more services; total duration drives end_at. */
  service_ids: z.array(z.string().uuid()).min(1, 'SERVICE_REQUIRED'),
  notes: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .or(z.literal('').transform(() => null)),
  status: z.enum(APPOINTMENT_STATUSES),
});
export type AppointmentInput = z.infer<typeof appointmentSchema>;

export const updateAppointmentSchema = appointmentSchema.extend({ id: z.string().uuid() });
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;

export const cancelAppointmentSchema = z.object({ id: z.string().uuid() });

/** Phase 38 — charge a deposit on an appointment. Amount is in cents. */
export const chargeAppointmentSchema = z.object({
  id: z.string().uuid(),
  amount_cents: z.number().int().min(50).max(100_000_00),
});

/** Phase 38 — refund the appointment's payment in full. */
export const refundAppointmentSchema = z.object({ id: z.string().uuid() });

/**
 * Reschedule (drag-to-move): move an existing appointment to a new
 * barber column and/or a new start time. Duration is preserved server-side
 * (we re-derive end_at = old_end - old_start + new_start) so the client
 * only carries the candidate start instant + target barber.
 */
export const rescheduleAppointmentSchema = z.object({
  id: z.string().uuid(),
  barber_id: z.string().uuid(),
  /** ISO 8601 UTC instant for the new start. */
  start_at: z.string().datetime(),
});
export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;

export const blockTimeSchema = z.object({
  barber_id: z.string().uuid().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'INVALID_DATE'),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, 'INVALID_TIME'),
  end_time: z.string().regex(/^\d{2}:\d{2}$/, 'INVALID_TIME'),
  reason: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .or(z.literal('').transform(() => null)),
});
export type BlockTimeInput = z.infer<typeof blockTimeSchema>;
