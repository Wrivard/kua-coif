import { z } from 'zod';

export const taxSchema = z.object({
  name: z.string().trim().min(1, 'NAME_REQUIRED').max(40),
  percentage: z.number().min(0).max(100),
  add_to_price: z.boolean(),
  external_orders_only: z.boolean(),
  enabled: z.boolean(),
});
export type TaxInput = z.infer<typeof taxSchema>;

export const updateTaxSchema = taxSchema.extend({ id: z.string().uuid() });
export type UpdateTaxInput = z.infer<typeof updateTaxSchema>;

export const deleteTaxSchema = z.object({ id: z.string().uuid() });
