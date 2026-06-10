import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LogOut, Mail } from 'lucide-react';
import { getCurrentUser, getShopMemberships } from '@/lib/auth/server';
import { Button } from '@/components/ui/button';
import { signOutAction } from '@/lib/auth/actions';

/**
 * Onboarding placeholder for users who finished signup but aren't a member of
 * any shop yet (V1 invitations from `lib/server-actions/users/invite` are
 * email-gated and require an admin action on the shop side).
 *
 * Used to be a dead route: `requireShopMember` redirected here and Next.js
 * served a 404 because the page didn't exist (caught in Phase 15 review).
 *
 * Shows two affordances:
 *   1. A reminder of the salon-owner contact flow (email + ask to be added).
 *   2. A sign-out button so the user isn't stuck on this screen.
 *
 * If the user *is* already a shop member, we bounce them home — no point
 * showing the dead-end UI.
 */
export default async function NoShopPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);

  const memberships = await getShopMemberships();
  if (memberships.length > 0) redirect(`/${locale}/`);

  return <NoShopContent locale={locale} email={user.email ?? ''} />;
}

function NoShopContent({ locale, email }: { locale: string; email: string }) {
  const t = useTranslations('pages.noShop');
  return (
    <div className="rounded border border-border bg-bg-surface p-8 text-center shadow-lg">
      <Mail className="mx-auto h-10 w-10 text-accent" aria-hidden />
      <h1 className="mt-4 text-xl font-semibold text-text-primary">{t('title')}</h1>
      <p className="mt-2 text-sm text-text-secondary">{t('description')}</p>

      <div className="mt-6 rounded border border-border bg-bg-base p-3 text-left text-sm">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
          {t('emailLabel')}
        </p>
        <p className="mt-1 font-mono text-text-primary">{email}</p>
      </div>

      <p className="mt-4 text-xs text-text-muted">{t('helpHint')}</p>

      <form action={signOutAction} className="mt-6">
        <input type="hidden" name="locale" value={locale} />
        <Button type="submit" variant="secondary" className="w-full">
          <LogOut className="h-4 w-4" /> {t('signOut')}
        </Button>
      </form>
    </div>
  );
}
