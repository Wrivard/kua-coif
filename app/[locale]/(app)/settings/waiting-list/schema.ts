import { z } from 'zod';

/**
 * Waiting-list config schema. Lives outside `actions.ts` for the same
 * reason as the loyalty fix in Loop 59: Next.js `'use server'` files
 * strip every non-async-function export from the client bundle, so a
 * client that imports `waitingListSchema` from `./actions` gets
 * `undefined` and crashes inside `zodResolver(undefined)`.
 */
export const waitingListSchema = z.object({
  enabled: z.boolean(),
  threshold_hours: z.number().int().min(0).max(72),
});

export type WaitingListInput = z.infer<typeof waitingListSchema>;
