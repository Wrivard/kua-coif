'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { getClientIp } from '@/lib/security/client-ip';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { defaultLocale, locales, type Locale } from '@/i18n';
import { checkRateLimit } from '@/lib/auth/rate-limit';

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  locale: z
    .string()
    .refine((v): v is Locale => (locales as readonly string[]).includes(v), 'invalid locale')
    .default(defaultLocale),
});

export type ForgotPasswordState =
  | { kind: 'idle' }
  | { kind: 'ok' }
  | { kind: 'invalid' }
  | { kind: 'rate-limited' }
  | { kind: 'error' };

/**
 * Triggers Supabase Auth's password-reset email. We deliberately return the
 * same successful state regardless of whether the email exists — leaking
 * "this address is registered" via differential responses is a well-known
 * enumeration vector. The email is rate-limited per-IP so the endpoint can't
 * be abused to spam someone's inbox either.
 *
 * The reset link in the email lands on `/<locale>/reset-password` (configured
 * via `redirectTo` here + the matching path in the Supabase dashboard's
 * "Redirect URLs" allowlist — DEPLOY.md covers the setup).
 */
export async function forgotPasswordAction(
  _prev: ForgotPasswordState | undefined,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const h = headers();
  const ip = getClientIp(h);
  const rl = await checkRateLimit(`forgot:${ip}`, { max: 3, windowMs: 10 * 60 * 1000 });
  if (!rl.allowed) return { kind: 'rate-limited' };

  const parsed = schema.safeParse({
    email: formData.get('email'),
    locale: formData.get('locale') ?? defaultLocale,
  });
  if (!parsed.success) return { kind: 'invalid' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServerClient() as any;
  const origin = h.get('origin') ?? process.env.NEXT_PUBLIC_SITE_URL ?? '';
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/${parsed.data.locale}/reset-password`,
  });

  // Always return the success branch — Supabase silently no-ops if the email
  // isn't registered, which is the behavior we want anyway.
  return { kind: 'ok' };
}
