import { z } from 'zod';
import { LOYALTY_TYPES } from '@/db/enums';

/**
 * Loyalty form schema. Lives in its own file because Next.js's
 * `'use server'` directive in `actions.ts` strips every non-async-
 * function export from the client bundle. The loyalty-client component
 * needs the schema at runtime (`zodResolver(loyaltySchema)`), so if we
 * defined it inside `actions.ts` the client would receive `undefined`
 * and crash on first render with the generic error boundary.
 *
 * Same split pattern as the rest of /settings/* (shop, payments,
 * notifications, etc.) — the schema-vs-action separation is the
 * canonical way to share a Zod schema across the server-action
 * boundary in App Router.
 */
export const loyaltySchema = z.object({
  enabled: z.boolean(),
  type: z.enum(LOYALTY_TYPES),
  goal_count: z.number().int().min(0).max(99999),
  min_transaction_amount: z.number().min(0).max(99999.99),
  reward_amount: z.number().min(0).max(99999.99),
  include_product_sales: z.boolean(),
  include_tips: z.boolean(),
});

export type LoyaltyInput = z.infer<typeof loyaltySchema>;
