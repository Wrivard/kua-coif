'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { defaultLocale, locales, type Locale } from '@/i18n';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { mapSupabaseAuthError, type AuthErrorCode } from '@/lib/auth/errors';

const schema = z.object({
  password: z.string().min(8, 'PASSWORD_TOO_SHORT').max(72),
  confirm: z.string().min(8),
  locale: z
    .string()
    .refine((v): v is Locale => (locales as readonly string[]).includes(v))
    .default(defaultLocale),
});

export type ResetPasswordState =
  | { kind: 'idle' }
  | { kind: 'invalid'; reason: 'mismatch' | 'weak' | 'shape' }
  | { kind: 'rate-limited' }
  | { kind: 'error'; code: AuthErrorCode };

/**
 * Update the signed-in user's password. The user lands on
 * `/<locale>/reset-password` from a Supabase password-reset email; the page
 * exchanges the PKCE `code` query param for a session BEFORE the user submits
 * the form, so by the time we get here the request is authenticated and we
 * can just call `auth.updateUser`.
 *
 * On success the user is redirected to `/login?signedUp=1` — they're already
 * signed in via the temporary session, but we sign them out via the redirect
 * so they re-authenticate with the new password (and so the temporary token
 * doesn't linger). For V1 the simpler "redirect home" works too, but the
 * extra sign-in feels reassuring to users coming out of a security flow.
 */
export async function resetPasswordAction(
  _prev: ResetPasswordState | undefined,
  formData: FormData,
): Promise<ResetPasswordState> {
  const h = headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rl = checkRateLimit(`reset:${ip}`, { max: 5, windowMs: 10 * 60 * 1000 });
  if (!rl.allowed) return { kind: 'rate-limited' };

  const parsed = schema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
    locale: formData.get('locale') ?? defaultLocale,
  });
  if (!parsed.success) return { kind: 'invalid', reason: 'shape' };
  if (parsed.data.password !== parsed.data.confirm) {
    return { kind: 'invalid', reason: 'mismatch' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServerClient() as any;
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { kind: 'error', code: mapSupabaseAuthError(error) };
  }

  // Sign out then bounce to login with the success hint — the user re-enters
  // their new password to confirm everything worked.
  await supabase.auth.signOut();
  redirect(`/${parsed.data.locale}/login?signedUp=1`);
}
