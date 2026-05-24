import { z } from 'zod';
import { BUSINESS_TYPES } from '@/db/enums';

export const paymentProfileSchema = z.object({
  legal_name: z
    .string()
    .trim()
    .max(120)
    .nullable()
    .or(z.literal('').transform(() => null)),
  business_type: z.enum(BUSINESS_TYPES).nullable(),
  dob: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'INVALID_DATE')
    .nullable()
    .or(z.literal('').transform(() => null)),
});
export type PaymentProfileInput = z.infer<typeof paymentProfileSchema>;
