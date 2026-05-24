import { z } from 'zod';
import { DISCOUNT_TYPES } from '@/db/enums';

export const promoCodeSchema = z.object({
  code: z.string().trim().min(2, 'NAME_REQUIRED').max(40),
  type: z.enum(DISCOUNT_TYPES),
  value: z.number().min(0).max(99999.99),
  first_appointment_only: z.boolean(),
  one_time: z.boolean(),
  expiration_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'INVALID_DATE')
    .nullable()
    .or(z.literal('').transform(() => null)),
});
export type PromoCodeInput = z.infer<typeof promoCodeSchema>;

export const updatePromoCodeSchema = promoCodeSchema.extend({ id: z.string().uuid() });
export type UpdatePromoCodeInput = z.infer<typeof updatePromoCodeSchema>;

export const deletePromoCodeSchema = z.object({ id: z.string().uuid() });
