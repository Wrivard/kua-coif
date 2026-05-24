'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { defaultLocale, locales, type Locale } from '@/i18n';

// Action result shape — what `useFormState` receives.
type FieldErrors = Partial<Record<'email' | 'password' | 'fullName', string>>;
export type AuthActionState =
  | { ok: false; error: string; fieldErrors?: FieldErrors }
  | { ok: true };

const localeSchema = z
  .string()
  .refine((v): v is Locale => (locales as readonly string[]).includes(v), {
    message: 'invalid locale',
  });

const emailSchema = z.string().trim().toLowerCase().email();
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password too long');

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
    return { ok: false, error: 'Invalid input', fieldErrors };
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const target = safeRedirectTarget(parsed.data.redirectTo ?? null, parsed.data.locale as Locale);
  redirect(target);
}

// ---------------------------------------------------------------------------
// Sign up
// ---------------------------------------------------------------------------
export async function signUpAction(
  _prev: AuthActionState | undefined,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = z
    .object({
      email: emailSchema,
      password: passwordSchema,
      fullName: z.string().trim().min(1, 'Full name required').max(120),
      locale: localeSchema.default(defaultLocale),
    })
    .safeParse({
      email: formData.get('email'),
      password: formData.get('password'),
      fullName: formData.get('fullName'),
      locale: formData.get('locale') ?? defaultLocale,
    });

  if (!parsed.success) {
    const fieldErrors: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0];
      if (path === 'email') fieldErrors.email = issue.message;
      if (path === 'password') fieldErrors.password = issue.message;
      if (path === 'fullName') fieldErrors.fullName = issue.message;
    }
    return { ok: false, error: 'Invalid input', fieldErrors };
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.fullName } },
  });

  if (error) return { ok: false, error: error.message };

  // If email confirmations are enabled in Supabase, the user lands here with
  // an unconfirmed session. We send them to a confirmation-pending page.
  redirect(`/${parsed.data.locale}/login?signedUp=1`);
}

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
