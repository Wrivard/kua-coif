import { z } from 'zod';

/**
 * Bulk review-campaign input. Operator selects a set of appointment IDs
 * from the candidate list; the action loads the corresponding clients,
 * generates a signed token per appointment, and dispatches email + SMS
 * subject to the shop's notification_automations.
 *
 * Cap at 50 per call — Loop 64 SR. The action does sequential email +
 * SMS per appointment (~150-300ms each); 50 clients × 2 channels at
 * 200ms = 20s worst-case, but typically lands under 10s. Vercel Hobby
 * caps server actions at 10s, so going over silently drops the tail.
 * Larger campaigns send in multiple clicks; the UI re-renders the
 * candidate list after each batch so the operator sees progress.
 */
export const sendReviewCampaignSchema = z.object({
  appointment_ids: z.array(z.string().uuid()).min(1).max(50),
});

export type SendReviewCampaignInput = z.infer<typeof sendReviewCampaignSchema>;
