import { setRequestLocale } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { ForgotPasswordForm } from './forgot-password-form';

type Props = { params: Promise<{ locale: string }> };

export default async function ForgotPasswordPage(props: Props) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  return <ForgotPasswordContent locale={locale} />;
}

function ForgotPasswordContent({ locale }: { locale: string }) {
  const t = useTranslations('auth.forgot');
  return (
    <div className="rounded-xl bg-bg-surface p-8 shadow-warm-lg">
      <h1 className="text-display-md text-text-primary">{t('title')}</h1>
      <p className="mt-1 text-sm text-text-secondary">{t('subtitle')}</p>

      <ForgotPasswordForm
        locale={locale}
        labels={{
          email: t('email'),
          submit: t('submit'),
          submitting: t('submitting'),
        }}
      />

      <p className="mt-6 text-center text-sm text-text-secondary">
        <Link href={`/${locale}/login`} className="text-accent hover:underline">
          {t('backToLogin')}
        </Link>
      </p>
    </div>
  );
}
