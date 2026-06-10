import { setRequestLocale } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { ResetPasswordForm } from './reset-password-form';

type Props = { params: Promise<{ locale: string }> };

export default async function ResetPasswordPage(props: Props) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  return <ResetPasswordContent locale={locale} />;
}

function ResetPasswordContent({ locale }: { locale: string }) {
  const t = useTranslations('auth.reset');
  return (
    <div className="rounded-xl bg-bg-surface p-8 shadow-warm-lg">
      <h1 className="text-display-md text-text-primary">{t('title')}</h1>
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
