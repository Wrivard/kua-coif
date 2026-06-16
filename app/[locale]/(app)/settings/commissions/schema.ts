import { z } from 'zod';
import { COMMISSION_SCOPES } from '@/db/enums';

// Thresholds are cumulative gross-revenue (CA) breakpoints stored in
// numeric(10,2) columns (see lib/business/commissions.ts) — dollar amounts, NOT
// integer counts. multipleOf(0.01) blocks sub-cent precision Postgres would
// silently round; do not switch these to .int(), which would reject valid cents.
const tierFields = {
  tier1_threshold: z.number().min(0).multipleOf(0.01),
  tier1_pct: z.number().min(0).max(100),
  tier2_threshold: z.number().min(0).multipleOf(0.01),
  tier2_pct: z.number().min(0).max(100),
  tier3_threshold: z.number().min(0).multipleOf(0.01),
  tier3_pct: z.number().min(0).max(100),
  tier4_threshold: z.number().min(0).multipleOf(0.01),
  tier4_pct: z.number().min(0).max(100),
  tier5_threshold: z.number().min(0).multipleOf(0.01),
  tier5_pct: z.number().min(0).max(100),
};

export const commissionRowSchema = z.object({
  barber_id: z.string().uuid(),
  scope: z.enum(COMMISSION_SCOPES),
  cumulative: z.boolean(),
  ...tierFields,
});
export type CommissionRowInput = z.infer<typeof commissionRowSchema>;

export const commissionBatchSchema = z.object({
  rows: z.array(commissionRowSchema).min(1),
});
export type CommissionBatchInput = z.infer<typeof commissionBatchSchema>;
