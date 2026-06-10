'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getClientIp } from '@/lib/security/client-ip';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
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

export type SetupPasswordState =
  | { kind: 'idle' }
  | { kind: 'invalid'; reason: 'mismatch' | 'weak' | 'shape' }
  | { kind: 'rate-limited' }
  | { kind: 'error'; code: AuthErrorCode };

/**
 * First-login setup for whitelist-invited users (Phase 22).
 *
 * The flow:
 *   1. Küa super-admin (or shop owner/manager) invites by email
 *      → `auth.admin.inviteUserByEmail` creates the user + sends the link.
 *   2. User clicks the link, lands on `/<locale>/setup-password?code=…`.
 *   3. The client component exchanges the PKCE code for a session BEFORE
 *      this Server Action runs.
 *   4. User submits a password — we call `auth.updateUser({ password })`.
 *   5. **Flip every `shop_members` row owned by this user from `staff` →
 *      `confirmed`**. That's the bit that "completes" the invite — the
 *      member now shows up as active in `/settings/users` for every shop
 *      they were invited to.
 *   6. Redirect home so they land in the dashboard.
 */
export async function setupPasswordAction(
  _prev: SetupPasswordState | undefined,
  formData: FormData,
): Promise<SetupPasswordState> {
  const ip = getClientIp();
  const rl = await checkRateLimit(`setup:${ip}`, { max: 5, windowMs: 10 * 60 * 1000 });
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

  // Get the signed-in user — the client component exchanged the code, so
  // this should return a valid user.
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return { kind: 'error', code: 'INVALID_CREDENTIALS' };
  }
  const userId = userData.user.id as string;

  // 1. Set the password.
  const { error: pwErr } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (pwErr) {
    return { kind: 'error', code: mapSupabaseAuthError(pwErr) };
  }

  // 2. Confirm every pending shop_members row for this user. We use the
  //    service-role client because RLS on `shop_members` only lets managers
  //    of the shop flip statuses — the invitee themselves can't, and
  //    rightly so for the general case. Here it's safe: the user proved
  //    ownership of the email via the PKCE link, and we only flip rows
  //    that already belonged to them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createSupabaseServiceRoleClient() as any;
  await admin
    .from('shop_members')
    .update({ status: 'confirmed' })
    .eq('user_id', userId)
    .eq('status', 'staff');

  redirect(`/${parsed.data.locale}/`);
}
