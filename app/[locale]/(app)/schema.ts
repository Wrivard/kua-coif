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
