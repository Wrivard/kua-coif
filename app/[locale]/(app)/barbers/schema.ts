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
  /**
   * Loop 44 (P120 follow-through) — avatar URL written by the
   * `<ImageUpload>` field in the barber form. Stored as a string URL
   * pointing at the `shop-assets` Storage bucket (or any other
   * public URL the manager wants to use). `null` for no avatar; the
   * sidebar / barbers list fall back to initials.
   */
  avatar_url: z
    .string()
    .trim()
    .url()
    .max(2048)
    .nullable()
    .or(z.literal('').transform(() => null)),
  // B17 — whether the barber is offered in public booking (independent of the
  // confirmed/staff/deleted status). Defaults true on the form.
  bookable: z.boolean(),
});
export type BarberInput = z.infer<typeof barberSchema>;

export const updateBarberSchema = barberSchema.extend({ id: z.string().uuid() });
export type UpdateBarberInput = z.infer<typeof updateBarberSchema>;

export const deleteBarberSchema = z.object({ id: z.string().uuid() });
export const setBarberStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(SHOP_MEMBER_STATUSES),
});

/** Phase 34 — disconnect a barber's Google Calendar. Removes the row from
 *  barber_google_calendar; future pushes/pulls no-op. */
export const disconnectGoogleSchema = z.object({ barber_id: z.string().uuid() });

/** B8 — invite a roster barber to log in themselves: email the person (or link
 *  an existing Küa profile) and set `barbers.user_id`. */
export const inviteBarberSchema = z.object({
  barber_id: z.string().uuid(),
  email: z.string().trim().toLowerCase().email(),
});
export type InviteBarberInput = z.infer<typeof inviteBarberSchema>;
