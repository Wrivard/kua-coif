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

export const cancelAppointmentSchema = z.object({
  id: z.string().uuid(),
  /**
   * Loop 25 — when true, also issue a full refund via the
   * appointment's PaymentIntent in the same call. No-op when the
   * appointment is not `payment_status === 'paid'`. Combined into one
   * action so an owner can't cancel-and-forget-to-refund (chargeback
   * risk identified in AUDIT_PHASE70 P1.12).
   */
  also_refund: z.boolean().optional().default(false),
  /**
   * Phase D — explicit override for the cancellation-policy window.
   * When `also_refund=true` and the appointment starts within the
   * shop's `mins_cancel_before_appt` window, the policy says the
   * customer forfeits their refund. The action rejects the refund in
   * that case UNLESS the admin explicitly sets this flag (i.e., they
   * acknowledged the "this is past the policy, refund anyway?" dialog).
   * Audit log records the override so we have a paper trail of
   * out-of-policy refunds.
   */
  force_refund: z.boolean().optional().default(false),
});

/** Phase 38 — charge a deposit on an appointment. Amount is in cents. */
export const chargeAppointmentSchema = z.object({
  id: z.string().uuid(),
  amount_cents: z.number().int().min(50).max(100_000_00),
});

/** Phase 38 — refund the appointment's payment in full. */
export const refundAppointmentSchema = z.object({ id: z.string().uuid() });

/**
 * Loop 28 — Bulk-cancel N appointments in one action call. The list
 * is capped at 100 (a full day for a typical 4-chair shop tops at
 * 60). The `also_refund` flag mirrors single-cancel: when true, every
 * row with `payment_status='paid'` and a `payment_intent_id` gets a
 * full refund via Stripe before the cancel update lands. Refund
 * errors are non-fatal — the cancel still proceeds, and the owner
 * can retry refunds individually from the drawer.
 */
export const bulkCancelAppointmentsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'NO_IDS').max(100, 'TOO_MANY_IDS'),
  also_refund: z.boolean().optional().default(false),
});
export type BulkCancelAppointmentsInput = z.infer<typeof bulkCancelAppointmentsSchema>;

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

/**
 * Loop 27 — recurrence options for block-time. `none` (default) keeps
 * the single-occurrence behaviour; `weekly`/`biweekly`/`monthly`
 * fan out to N rows server-side up to `until_date`. We cap at 1 year
 * out in the action to keep payloads bounded (a barber who blocks
 * every Sunday for 5 years would otherwise insert 260 rows in one
 * call).
 */
export const BLOCK_TIME_RECURRENCES = ['none', 'weekly', 'biweekly', 'monthly'] as const;
export type BlockTimeRecurrence = (typeof BLOCK_TIME_RECURRENCES)[number];

export const blockTimeSchema = z
  .object({
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
    /**
     * `none` (default) → single row. `weekly`/`biweekly`/`monthly` →
     * the action repeats from `date` up to `until_date` (required when
     * recurrence is set).
     */
    recurrence: z.enum(BLOCK_TIME_RECURRENCES).optional().default('none'),
    until_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'INVALID_DATE')
      .nullable()
      .optional()
      .default(null),
  })
  /**
   * Loop 27 self-review — block a submission that asks for recurrence
   * without an until-date. Without this refine the action returned a
   * generic INVALID_INPUT and the user saw a confusing "erreur
   * inattendue" toast instead of a field-specific message. Same
   * applies to an until-date BEFORE the start date: catch it in the
   * form rather than letting the server enumerate 0 dates and
   * silently no-op.
   */
  .superRefine((val, ctx) => {
    if (val.recurrence !== 'none' && !val.until_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['until_date'],
        message: 'UNTIL_DATE_REQUIRED',
      });
    }
    if (val.until_date && val.until_date < val.date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['until_date'],
        message: 'UNTIL_DATE_BEFORE_START',
      });
    }
  });
export type BlockTimeInput = z.infer<typeof blockTimeSchema>;
