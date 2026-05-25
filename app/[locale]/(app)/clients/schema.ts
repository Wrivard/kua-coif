import { z } from 'zod';

const phoneRegex = /^[+\d\s().-]{7,20}$/;

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .nullable()
  .or(z.literal('').transform(() => null));

const optionalPhone = z
  .string()
  .trim()
  .regex(phoneRegex, 'PHONE_INVALID')
  .nullable()
  .or(z.literal('').transform(() => null));

export const clientSchema = z.object({
  first_name: z.string().trim().min(1, 'NAME_REQUIRED').max(120),
  last_name: z
    .string()
    .trim()
    .max(120)
    .nullable()
    .or(z.literal('').transform(() => null)),
  email: optionalEmail,
  phone: optionalPhone,
  notes: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .or(z.literal('').transform(() => null)),
});
export type ClientInput = z.infer<typeof clientSchema>;

export const updateClientSchema = clientSchema.extend({ id: z.string().uuid() });
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

export const deleteClientSchema = z.object({ id: z.string().uuid() });

/** Phase 40 — Loi 25 export + anonymize. Both take just the client id. */
export const exportClientSchema = z.object({ id: z.string().uuid() });
export const anonymizeClientSchema = z.object({ id: z.string().uuid() });
