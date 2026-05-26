import { setRequestLocale } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { ResetPasswordForm } from './reset-password-form';

type Props = { params: { locale: string } };

export default function ResetPasswordPage({ params: { locale } }: Props) {
  setRequestLocale(locale);
  return <ResetPasswordContent locale={locale} />;
}

function ResetPasswordContent({ locale }: { locale: string }) {
  const t = useTranslations('auth.reset');
  return (
    <div className="rounded-lg bg-bg-surface p-8 shadow-lg">
      <h1 className="text-2xl font-semibold text-text-primary">{t('title')}</h1>
      <p className="mt-1 text-sm text-text-secondary">{t('subtitle')}</p>

      <ResetPasswordForm
        locale={locale}
        labels={{
          password: t('password'),
          confirm: t('confirm'),
          submit: t('submit'),
          submitting: t('submitting'),
        }}
      />
    </div>
  );
}
