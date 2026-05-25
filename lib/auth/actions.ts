'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { defaultLocale, locales, type Locale } from '@/i18n';
import { mapSupabaseAuthError, type AuthErrorCode } from './errors';
import { checkRateLimit } from './rate-limit';

// Action result shape — what `useFormState` receives.
type FieldErrors = Partial<Record<'email' | 'password' | 'fullName', string>>;
export type AuthActionState =
  | { ok: false; errorCode: AuthErrorCode; fieldErrors?: FieldErrors }
  | { ok: true };

const localeSchema = z
  .string()
  .refine((v): v is Locale => (locales as readonly string[]).includes(v), {
    message: 'invalid locale',
  });

const emailSchema = z.string().trim().toLowerCase().email();
const passwordSchema = z.string().min(8, 'PASSWORD_TOO_SHORT').max(72, 'PASSWORD_TOO_LONG');

function safeRedirectTarget(input: string | null | undefined, locale: Locale): string {
  // Only allow same-origin relative paths under the locale.
  if (!input) return `/${locale}/`;
  if (!input.startsWith('/')) return `/${locale}/`;
  if (input.startsWith('//')) return `/${locale}/`;
  return input;
}

/** Best-effort client IP for rate limiting (Vercel sets x-forwarded-for). */
function clientIp(): string {
  const h = headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown';
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------
export async function signInAction(
  _prev: AuthActionState | undefined,
  formData: FormData,
): Promise<AuthActionState> {
  // 1. Rate-limit BEFORE touching Supabase to blunt brute-force attempts.
  const ip = clientIp();
  const rl = await checkRateLimit(`signin:${ip}`, { max: 5, windowMs: 10 * 60 * 1000 });
  if (!rl.allowed) {
    return { ok: false, errorCode: 'TOO_MANY_REQUESTS' };
  }

  const parsed = z
    .object({
      email: emailSchema,
      password: passwordSchema,
      locale: localeSchema.default(defaultLocale),
      redirectTo: z.string().nullish(),
    })
    .safeParse({
      email: formData.get('email'),
      password: formData.get('password'),
      locale: formData.get('locale') ?? defaultLocale,
      redirectTo: formData.get('redirect'),
    });

  if (!parsed.success) {
    const fieldErrors: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0];
      if (path === 'email') fieldErrors.email = issue.message;
      if (path === 'password') fieldErrors.password = issue.message;
    }
    return { ok: false, errorCode: 'INVALID_INPUT', fieldErrors };
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { ok: false, errorCode: mapSupabaseAuthError(error) };
  }

  const target = safeRedirectTarget(parsed.data.redirectTo ?? null, parsed.data.locale as Locale);
  redirect(target);
}

// ---------------------------------------------------------------------------
// Sign up — REMOVED in Phase 22.
// ---------------------------------------------------------------------------
// Self-signup is disabled by the whitelist auth model. New accounts are
// created exclusively via:
//   - `/admin/shops/new` (Küa super-admin creates owners)
//   - `/settings/users` (existing owners / managers invite their staff)
// Both go through `supabase.auth.admin.inviteUserByEmail` server-side, never
// from a public form. The Supabase Auth dashboard's "Enable email signups"
// toggle is also off as a belt-and-braces defense.

// ---------------------------------------------------------------------------
// Sign out
// ---------------------------------------------------------------------------
export async function signOutAction(formData: FormData): Promise<void> {
  const localeInput = formData.get('locale');
  const locale: Locale = (locales as readonly string[]).includes(String(localeInput))
    ? (localeInput as Locale)
    : defaultLocale;

  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect(`/${locale}/login`);
}
