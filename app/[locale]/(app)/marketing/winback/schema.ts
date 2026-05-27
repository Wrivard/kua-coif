import { z } from 'zod';

/**
 * Bulk winback input. Operator selects a set of client IDs from the
 * candidate list; the action generates the booking URL per client
 * and dispatches email + SMS.
 *
 * Cap at 50 per call — Loop 64 SR. Same reasoning as the review-
 * campaign schema: sequential email + SMS dispatch ~150-300ms each,
 * 50 × 2 channels at 200ms = 20s worst-case but typically under 10s.
 * Vercel Hobby caps server actions at 10s. Larger batches via
 * multiple clicks — the page reloads on each send so the operator
 * sees the candidate list shrink.
 */
export const sendWinbackSchema = z.object({
  client_ids: z.array(z.string().uuid()).min(1).max(50),
});

export type SendWinbackInput = z.infer<typeof sendWinbackSchema>;
