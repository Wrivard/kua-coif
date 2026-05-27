import { z } from 'zod';

/**
 * Bulk winback input. Operator selects a set of client IDs from the
 * candidate list; the action generates the booking URL per client
 * and dispatches email + SMS.
 *
 * Capped at 200 per call. Larger batches over multiple clicks.
 */
export const sendWinbackSchema = z.object({
  client_ids: z.array(z.string().uuid()).min(1).max(200),
});

export type SendWinbackInput = z.infer<typeof sendWinbackSchema>;
