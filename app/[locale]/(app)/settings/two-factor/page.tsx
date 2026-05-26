import { setRequestLocale } from 'next-intl/server';
import { requireShopMember } from '@/lib/auth/server';
import { PageHeader } from '@/components/ui/page-header';
import { TwoFactorClient } from './two-factor-client';

export const dynamic = 'force-dynamic';

/**
 * Phase 67 — 2FA enrollment via Supabase Auth MFA (TOTP).
 *
 * The page itself is a thin shell — all the real work happens client-
 * side because `supabase.auth.mfa.*` requires the user session in the
 * browser. The middleware will gate the sign-in flow on completed
 * challenges once we wire it up (V1.1) — for V1 enrollment is
 * voluntary and protects only re-auth events.
 */
export default async function TwoFactorPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  setRequestLocale(locale);
  await requireShopMember({ locale });

  return (
    <>
      <PageHeader title="Two-factor authentication" />
      <TwoFactorClient />
    </>
  );
}
