import { setRequestLocale } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { LoginForm } from './login-form';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ redirect?: string; signedUp?: string }>;
};

export default async function LoginPage(props: Props) {
  const searchParams = await props.searchParams;
  const params = await props.params;

  const { locale } = params;

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
    <div className="rounded-xl bg-bg-surface p-8 shadow-warm-lg">
      <div className="text-center">
        <h1 className="text-display-md text-text-primary">{t('title')}</h1>
        <p className="mt-2 text-sm text-text-secondary">{t('subtitle')}</p>
      </div>

      {searchParams.signedUp ? (
        <p
          role="status"
          className="mt-6 rounded-lg border border-success/30 bg-success-subtle px-3 py-2 text-xs text-success"
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

      <p className="mt-5 text-center text-xs">
        <Link
          href={`/${locale}/forgot-password`}
          className="rounded text-text-muted transition-colors hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {t('forgotLink')}
        </Link>
      </p>

      <div className="mt-6 border-t border-border pt-4">
        <p className="text-center text-xs leading-relaxed text-text-muted">
          {t('byInvitationOnly')}
        </p>
      </div>
    </div>
  );
}
