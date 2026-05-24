import { setRequestLocale } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { SignupForm } from './signup-form';

export default function SignupPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <SignupPageContent locale={locale} />;
}

function SignupPageContent({ locale }: { locale: string }) {
  const t = useTranslations('auth.signup');
  return (
    <div className="rounded border border-border bg-bg-surface p-8 shadow-lg">
      <h1 className="text-2xl font-semibold text-text-primary">{t('title')}</h1>
      <p className="mt-1 text-sm text-text-secondary">{t('subtitle')}</p>

      <SignupForm
        locale={locale}
        labels={{
          fullName: t('fullName'),
          email: t('email'),
          password: t('password'),
          submit: t('submit'),
          submitting: t('submitting'),
        }}
      />

      <p className="mt-6 text-center text-sm text-text-secondary">
        {t('hasAccount')}{' '}
        <Link href={`/${locale}/login`} className="text-accent hover:underline">
          {t('loginLink')}
        </Link>
      </p>
    </div>
  );
}
