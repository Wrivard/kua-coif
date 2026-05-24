import { setRequestLocale } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { PagePlaceholder } from '@/components/features/shell/page-placeholder';

export default function SettingsPasswordPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  setRequestLocale(locale);
  return <Content />;
}

function Content() {
  const t = useTranslations('pages.settings.password');
  return <PagePlaceholder title={t('title')} description={t('soon')} phase="Phase 6" />;
}
