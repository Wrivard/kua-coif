import type { AuthError } from '@supabase/supabase-js';

/**
 * Stable, user-safe error codes the UI can translate. We never let Supabase's
 * raw `error.message` reach the client — both because some messages reveal
 * implementation details and because they aren't localized.
 *
 * Mapping table sourced from @supabase/supabase-js error codes
 * (https://supabase.com/docs/reference/javascript/auth-error). Unknown errors
 * fall back to UNEXPECTED.
 */
export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_NOT_CONFIRMED'
  | 'EMAIL_ALREADY_EXISTS'
  | 'WEAK_PASSWORD'
  | 'RATE_LIMITED'
  | 'TOO_MANY_REQUESTS'
  | 'INVALID_INPUT'
  | 'UNEXPECTED';

const codeMap: Record<string, AuthErrorCode> = {
  invalid_credentials: 'INVALID_CREDENTIALS',
  invalid_grant: 'INVALID_CREDENTIALS',
  email_not_confirmed: 'EMAIL_NOT_CONFIRMED',
  user_already_exists: 'EMAIL_ALREADY_EXISTS',
  email_exists: 'EMAIL_ALREADY_EXISTS',
  weak_password: 'WEAK_PASSWORD',
  over_request_rate_limit: 'RATE_LIMITED',
  over_email_send_rate_limit: 'RATE_LIMITED',
};

/**
 * Convert a Supabase `AuthError` (or any thrown object) to a stable code that
 * the UI can map to a localized string. Logs the raw error to the server
 * console (never to the client) for debugging.
 */
export function mapSupabaseAuthError(
  error: AuthError | { code?: string; message?: string } | null | undefined,
): AuthErrorCode {
  if (!error) return 'UNEXPECTED';

  const code = (error as { code?: string }).code;
  if (code && codeMap[code]) return codeMap[code]!;

  // Some older Supabase responses only set `message`. Match a few well-known
  // phrases as a last resort, then fall through to UNEXPECTED.
  const msg = (error.message ?? '').toLowerCase();
  if (msg.includes('invalid login')) return 'INVALID_CREDENTIALS';
  if (msg.includes('email not confirmed')) return 'EMAIL_NOT_CONFIRMED';
  if (msg.includes('already registered') || msg.includes('already exists'))
    return 'EMAIL_ALREADY_EXISTS';
  if (msg.includes('rate limit')) return 'RATE_LIMITED';

  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.warn('[auth] unmapped Supabase error:', { code, message: error.message });
  }

  return 'UNEXPECTED';
}
