import { setRequestLocale } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { PagePlaceholder } from '@/components/features/shell/page-placeholder';

export default function SettingsShopPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <Content />;
}

function Content() {
  const t = useTranslations('pages.settings.shop');
  return <PagePlaceholder title={t('title')} description={t('soon')} phase="Phase 6" />;
}
