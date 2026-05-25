import { z } from 'zod';

/**
 * Schemas for `/settings/notifications` Server Actions. Kept in a separate
 * file from `actions.ts` because Next.js's `'use server'` directive forbids
 * non-function exports — and these Zod schemas are values, not functions.
 */

export const senderConfigSchema = z.object({
  from_email: z.string().trim().toLowerCase().email().or(z.literal('')),
  from_name: z.string().trim().max(120).optional().or(z.literal('')),
  smtp_host: z.string().trim().max(200).optional().or(z.literal('')),
  smtp_port: z.number().int().min(1).max(65535).nullable().optional(),
  smtp_user: z.string().trim().max(200).optional().or(z.literal('')),
  /**
   * Empty string = "keep the existing encrypted password" (the form is
   * write-only — we never echo the current value back, so the user submits
   * blank when they're only changing other fields). Non-empty = new
   * password to encrypt + store.
   */
  smtp_password: z.string().max(500).optional().or(z.literal('')),
});

export type SenderConfigInput = z.infer<typeof senderConfigSchema>;

export const testConnectionSchema = z.object({
  from_email: z.string().trim().toLowerCase().email(),
  from_name: z.string().trim().max(120).optional().or(z.literal('')),
  smtp_host: z.string().trim().min(1).max(200),
  smtp_port: z.number().int().min(1).max(65535),
  smtp_user: z.string().trim().min(1).max(200),
  smtp_password: z.string().min(1).max(500),
});

export const toggleAutomationSchema = z.object({
  id: z.string().uuid(),
  enabled: z.boolean(),
});
