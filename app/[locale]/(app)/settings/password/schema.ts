import { z } from 'zod';

// Next 15 — a 'use server' module may export only async functions, so the
// schema + its inferred type live here (a plain module) and are imported by
// both the action and the client form.
export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, 'CURRENT_PASSWORD_REQUIRED'),
    new_password: z.string().min(8, 'PASSWORD_TOO_SHORT').max(72),
    confirm_password: z.string(),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    message: 'PASSWORDS_DONT_MATCH',
    path: ['confirm_password'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
