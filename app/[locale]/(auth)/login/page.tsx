import { setRequestLocale } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { LoginForm } from './login-form';

type Props = {
  params: { locale: string };
  searchParams: { redirect?: string; signedUp?: string };
};

export default function LoginPage({ params: { locale }, searchParams }: Props) {
  setRequestLocale(locale);
  return <LoginPageContent locale={locale} searchParams={searchParams} />;
}

function LoginPageContent({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: { redirect?: string; signedUp?: string };
}) {
  const t = useTranslations('auth.login');
  return (
    <div className="rounded border border-border bg-bg-surface p-8 shadow-lg">
      <h1 className="text-2xl font-semibold text-text-primary">{t('title')}</h1>
      <p className="mt-1 text-sm text-text-secondary">{t('subtitle')}</p>

      {searchParams.signedUp ? (
        <p
          role="status"
          className="border-success/40 bg-success/10 mt-4 rounded border px-3 py-2 text-xs text-success"
        >
          {t('signedUpHint')}
        </p>
      ) : null}

      <LoginForm
        locale={locale}
        redirectTo={searchParams.redirect ?? ''}
        labels={{
          email: t('email'),
          password: t('password'),
          submit: t('submit'),
          submitting: t('submitting'),
        }}
      />

      <p className="mt-4 text-center text-xs">
        <Link href={`/${locale}/forgot-password`} className="text-text-muted hover:text-accent">
          {t('forgotLink')}
        </Link>
      </p>

      {/* Self-signup is disabled (Phase 22 — whitelist auth). Accounts are
          created by Küa admins or by existing shop owners/managers via the
          invitation flow. We surface the policy explicitly so an unaffiliated
          visitor isn't left wondering how to sign up. */}
      <p className="mt-6 text-center text-xs text-text-muted">{t('byInvitationOnly')}</p>
    </div>
  );
}
