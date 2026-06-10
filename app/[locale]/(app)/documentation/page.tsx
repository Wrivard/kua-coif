import { setRequestLocale } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/ui/page-header';
import { DocumentationBrowser } from './documentation-browser';
import type { DocLocale } from './content';

export default async function DocumentationPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  return <Content locale={locale} />;
}

function Content({ locale }: { locale: string }) {
  const t = useTranslations('pages.documentation');
  const tNav = useTranslations('nav');
  const docLocale: DocLocale = locale === 'fr' ? 'fr' : 'en';
  return (
    <>
      <PageHeader eyebrow={tNav('documentation')} title={t('title')} subtitle={t('subtitle')} />
      <div className="p-4 md:p-6">
        <DocumentationBrowser locale={docLocale} />
      </div>
    </>
  );
}
