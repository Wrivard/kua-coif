/**
 * Resend client — Phase 24.
 *
 * **DSN-gated activation** (same dormant-until-configured pattern as Sentry
 * in Phase 13). The client is only constructed when both `RESEND_API_KEY`
 * and `RESEND_FROM` are present:
 *
 *   - Locally / preview / pre-account: env vars unset, the helper exposes
 *     `null` and `lib/email/send.ts` no-ops. No accidental sends, no errors.
 *   - In prod: user creates a Resend account, verifies `kua.quebec` (or
 *     uses `onboarding@resend.dev` for testing), drops two env vars in
 *     Vercel, redeploys. Next request flows through Resend.
 *
 * Required env vars to activate:
 *
 *   RESEND_API_KEY   — `re_abc…`, from https://resend.com/api-keys
 *   RESEND_FROM      — `"Küa <noreply@kua.quebec>"`, or `onboarding@resend.dev`
 *                       while waiting for DNS verification.
 *
 * Optional:
 *
 *   RESEND_REPLY_TO  — e.g. `support@kua.quebec`. Falls back to RESEND_FROM.
 */
import { Resend } from 'resend';

export type EmailConfig = {
  client: Resend;
  from: string;
  replyTo?: string;
};

let cachedConfig: EmailConfig | null | undefined; // undefined = not yet probed

/**
 * Returns a ready-to-use Resend client + envelope defaults, or `null` if
 * the env vars haven't been set. Callers should check `null` and skip
 * silently rather than throwing — outbound email is non-essential to the
 * core booking flow.
 */
export function getEmailConfig(): EmailConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) {
    cachedConfig = null;
    return null;
  }
  cachedConfig = {
    client: new Resend(apiKey),
    from,
    replyTo: process.env.RESEND_REPLY_TO,
  };
  return cachedConfig;
}

/** Test helper — clears the cache so vars-changed tests can re-probe. */
export function _resetEmailClientCache() {
  cachedConfig = undefined;
}
