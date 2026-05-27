import { z } from 'zod';

/**
 * Bulk review-campaign input. Operator selects a set of appointment IDs
 * from the candidate list; the action loads the corresponding clients,
 * generates a signed token per appointment, and dispatches email + SMS
 * subject to the shop's notification_automations.
 *
 * Cap at 200 IDs per call to keep the action's max-duration honest
 * (each send is ~100-300ms via Resend + Twilio). Larger batches can be
 * sent in multiple clicks.
 */
export const sendReviewCampaignSchema = z.object({
  appointment_ids: z.array(z.string().uuid()).min(1).max(200),
});

export type SendReviewCampaignInput = z.infer<typeof sendReviewCampaignSchema>;
