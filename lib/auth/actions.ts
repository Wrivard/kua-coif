'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { getClientIp } from '@/lib/security/client-ip';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { defaultLocale, locales, type Locale } from '@/i18n';
import { mapSupabaseAuthError, type AuthErrorCode } from './errors';
import { checkRateLimit } from './rate-limit';
import { SHOP_COOKIE } from './server';

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

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------
export async function signInAction(
  _prev: AuthActionState | undefined,
  formData: FormData,
): Promise<AuthActionState> {
  // 1. Rate-limit BEFORE touching Supabase to blunt brute-force attempts.
  const ip = getClientIp();
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
  // Security audit #7 — clear the active-shop cookie on sign-out. Pre-fix
  // the cookie persisted, so if a different user logged in on the same
  // browser and happened to share a membership in the cookied shop, the
  // stale cookie won the role lookup. `getCurrentShopId` validates the
  // cookie against memberships before trusting it, so impact is bounded,
  // but a stale UI on a shared workstation is still confusing.
  cookies().delete(SHOP_COOKIE);
  redirect(`/${locale}/login`);
}
