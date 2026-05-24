import { z } from 'zod';
import { COMMISSION_SCOPES } from '@/db/enums';

const tierFields = {
  tier1_threshold: z.number().min(0),
  tier1_pct: z.number().min(0).max(100),
  tier2_threshold: z.number().min(0),
  tier2_pct: z.number().min(0).max(100),
  tier3_threshold: z.number().min(0),
  tier3_pct: z.number().min(0).max(100),
  tier4_threshold: z.number().min(0),
  tier4_pct: z.number().min(0).max(100),
  tier5_threshold: z.number().min(0),
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
