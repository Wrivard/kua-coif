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

/**
 * Loop 33 (Phase 90) — owner-facing Slack webhook URL. Empty string
 * clears the value (we explicitly write null), any other string must
 * be a valid HTTPS URL. Slack's incoming-webhooks live under
 * hooks.slack.com but we don't enforce that — Discord and Mattermost
 * expose Slack-compatible endpoints and shops should be free to use
 * those.
 */
export const slackWebhookSchema = z.object({
  slack_webhook_url: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === '' || /^https:\/\/.+/.test(v), 'INVALID_URL'),
});

export type SlackWebhookInput = z.infer<typeof slackWebhookSchema>;

// ---------------------------------------------------------------------------
// Loop 56 (P100 slice 4) — Twilio SMS credentials.
//
// account_sid is "AC" + 32 hex chars per Twilio docs. We enforce the format
// upfront so a typo (or pasting the wrong column from the Twilio console)
// fails validation rather than reaching the API and burning a tick.
// auth_token is the write-only secret (same pattern as smtp_password):
// blank = keep the existing ciphertext, non-blank = encrypt + replace.
// from_number must be E.164 (Twilio rejects anything else).
// ---------------------------------------------------------------------------

const accountSidRegex = /^AC[a-zA-Z0-9]{32}$/;
const e164Regex = /^\+[1-9]\d{6,14}$/;

export const twilioConfigSchema = z.object({
  twilio_account_sid: z
    .string()
    .trim()
    .regex(accountSidRegex, 'INVALID_ACCOUNT_SID')
    .or(z.literal('')),
  twilio_auth_token: z.string().trim().max(500).optional().or(z.literal('')),
  twilio_from_number: z.string().trim().regex(e164Regex, 'INVALID_PHONE_E164').or(z.literal('')),
});

export type TwilioConfigInput = z.infer<typeof twilioConfigSchema>;

/**
 * Send a real SMS to the operator's own phone to validate creds end-to-end.
 * All four fields are required (unlike upsert, where blanks have meaning):
 * we need the plaintext auth_token to call Twilio, and the test number to
 * deliver to.
 */
export const twilioTestSchema = z.object({
  twilio_account_sid: z.string().trim().regex(accountSidRegex, 'INVALID_ACCOUNT_SID'),
  twilio_auth_token: z.string().trim().min(1).max(500),
  twilio_from_number: z.string().trim().regex(e164Regex, 'INVALID_PHONE_E164'),
  test_to_number: z.string().trim().regex(e164Regex, 'INVALID_PHONE_E164'),
});
