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

// Phase D — per-shop payment mode toggle. Mirrors the CHECK constraint
// on `shops.payment_mode`. The action additionally requires Stripe
// Connect to be active before allowing 'full' or 'deposit'; 'none'
// always works regardless of Connect status.
export const PAYMENT_MODES = ['full', 'deposit', 'none'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
export const paymentModeSchema = z.object({
  payment_mode: z.enum(PAYMENT_MODES),
});
export type PaymentModeInput = z.infer<typeof paymentModeSchema>;
