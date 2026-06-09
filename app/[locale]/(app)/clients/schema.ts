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

// Loop 62 — optional birthday in YYYY-MM-DD form. Empty string maps to
// null so the form doesn't have to special-case "no value". Refusing
// future dates would be tempting but ages are weird (a client born
// 1900-01-01 is fine; "client born tomorrow" is obviously a typo but
// we don't enforce it server-side — the UI can flag it as a soft
// warning if we feel like it later).
const optionalDob = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'DOB_INVALID')
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
  date_of_birth: optionalDob,
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

/**
 * Clients audit W4 — merge a duplicate. `merge_id` is folded into `keep_id`
 * (its appointments/reviews/marketing-sends re-point to keep, loyalty
 * balances combine, then the merge row is deleted) via the merge_clients
 * Postgres function.
 */
export const mergeClientsSchema = z.object({
  keep_id: z.string().uuid(),
  merge_id: z.string().uuid(),
});

/**
 * Clients audit W5c — revoke a client's /me self-service links by bumping
 * their token version (every outstanding /me token then fails to verify).
 */
export const revokeMeAccessSchema = z.object({ id: z.string().uuid() });
