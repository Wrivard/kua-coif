import { z } from 'zod';
import { SERVICE_STATUSES } from '@/db/enums';

/**
 * Zod schema for service create/update. Used both client-side (with
 * react-hook-form + @hookform/resolvers/zod) and server-side (in the
 * Server Action via withAction).
 */
export const serviceSchema = z.object({
  name: z.string().trim().min(1, 'NAME_REQUIRED').max(120),
  category_id: z.string().uuid().nullable(),
  duration_min: z
    .number()
    .int()
    .min(5, 'DURATION_MIN')
    .max(8 * 60, 'DURATION_MAX'),
  price: z.number().min(0).max(99999.99),
  status: z.enum(SERVICE_STATUSES),
  tax_ids: z.array(z.string().uuid()),
});

export type ServiceInput = z.infer<typeof serviceSchema>;

export const updateServiceSchema = serviceSchema.extend({
  id: z.string().uuid(),
});
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;

export const deleteServiceSchema = z.object({ id: z.string().uuid() });
export const toggleServiceStatusSchema = z.object({ id: z.string().uuid() });
