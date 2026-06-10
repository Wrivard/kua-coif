import { setRequestLocale } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { PagePlaceholder } from '@/components/features/shell/page-placeholder';

export default async function SupportPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  return <Content />;
}

function Content() {
  const t = useTranslations('pages.support');
  return <PagePlaceholder title={t('title')} description={t('soon')} phase="Phase 9" />;
}
