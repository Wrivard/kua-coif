import { setRequestLocale } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { SetupPasswordForm } from './setup-password-form';

type Props = { params: Promise<{ locale: string }> };

export default async function SetupPasswordPage(props: Props) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  return <SetupPasswordContent locale={locale} />;
}

function SetupPasswordContent({ locale }: { locale: string }) {
  const t = useTranslations('auth.setup');
  return (
    <div className="rounded-xl bg-bg-surface p-8 shadow-warm-lg">
      <h1 className="text-display-md text-text-primary">{t('title')}</h1>
      <p className="mt-1 text-sm text-text-secondary">{t('subtitle')}</p>

      <SetupPasswordForm
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
