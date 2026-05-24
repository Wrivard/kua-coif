import { z } from 'zod';
import { SHOP_MEMBER_STATUSES } from '@/db/enums';

const phoneRegex = /^[+\d\s().-]{7,20}$/;

export const barberSchema = z.object({
  display_name: z.string().trim().min(1, 'NAME_REQUIRED').max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .nullable()
    .or(z.literal('').transform(() => null)),
  phone: z
    .string()
    .trim()
    .regex(phoneRegex, 'PHONE_INVALID')
    .nullable()
    .or(z.literal('').transform(() => null)),
  personnel_id: z
    .string()
    .trim()
    .max(50)
    .nullable()
    .or(z.literal('').transform(() => null)),
  status: z.enum(SHOP_MEMBER_STATUSES),
});
export type BarberInput = z.infer<typeof barberSchema>;

export const updateBarberSchema = barberSchema.extend({ id: z.string().uuid() });
export type UpdateBarberInput = z.infer<typeof updateBarberSchema>;

export const deleteBarberSchema = z.object({ id: z.string().uuid() });
export const setBarberStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(SHOP_MEMBER_STATUSES),
});
