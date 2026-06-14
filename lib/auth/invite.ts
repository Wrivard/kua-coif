import { headers } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/db/types';
import { defaultLocale } from '@/i18n';

/**
 * Resolve the auth-user id for an email, inviting a brand-new user if needed.
 *
 * Shared by `inviteUser` (settings/users) and `inviteBarber` (barbers) so the
 * two invite entry points don't reinvent the two-path logic:
 *
 *   - **Existing profile** → reuse `profiles.id`; no email sent (they keep
 *     their password). `isNew: false`.
 *   - **No profile** → `auth.admin.inviteUserByEmail` creates the `auth.users`
 *     row (the `tg_create_profile_on_signup` trigger fills `profiles`) and ships
 *     a PKCE invite landing on `/<locale>/setup-password`. `isNew: true`.
 *
 * Returns `{ error: 'CONFLICT' }` when Supabase rejects the invite — most
 * commonly the email is already in `auth.users` with no matching `profiles`
 * row (rare race) — so callers surface a clean CONFLICT, not a raw error.
 *
 * Takes the service-role client as a param (the caller owns RLS scoping); never
 * creates its own so unit tests can inject a fixture client.
 */
export async function resolveOrInviteAuthUser(
  sb: SupabaseClient<Database>,
  email: string,
): Promise<{ userId: string; isNew: boolean } | { error: 'CONFLICT' }> {
  const profileRes = await sb.from('profiles').select('id').eq('email', email).limit(1);
  const profile = (profileRes.data ?? [])[0];
  if (profile) return { userId: profile.id, isNew: false };

  const origin = (await headers()).get('origin') ?? process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const inviteRes = await sb.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/${defaultLocale}/setup-password`,
  });
  if (inviteRes.error || !inviteRes.data?.user) return { error: 'CONFLICT' };
  return { userId: inviteRes.data.user.id as string, isNew: true };
}
