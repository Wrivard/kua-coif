import { z } from 'zod';
import { DISCOUNT_ASSIGNMENTS, DISCOUNT_TYPES } from '@/db/enums';

// CHECK constraint in DB ensures percent <= 100; we rely on it to keep the
// schema flat (so it stays composable with .extend()).
export const discountSchema = z.object({
  name: z.string().trim().min(1, 'NAME_REQUIRED').max(80),
  type: z.enum(DISCOUNT_TYPES),
  value: z.number().min(0).max(99999.99),
  assignment: z.enum(DISCOUNT_ASSIGNMENTS),
});
export type DiscountInput = z.infer<typeof discountSchema>;

export const updateDiscountSchema = discountSchema.extend({ id: z.string().uuid() });
export type UpdateDiscountInput = z.infer<typeof updateDiscountSchema>;

export const deleteDiscountSchema = z.object({ id: z.string().uuid() });
