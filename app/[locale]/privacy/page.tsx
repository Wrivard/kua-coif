import { setRequestLocale } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import type { Metadata } from 'next';
import Link from 'next/link';

export const dynamic = 'force-static';

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string };
}): Promise<Metadata> {
  return {
    title: locale === 'fr' ? 'Politique de confidentialité' : 'Privacy Policy',
    robots: { index: true, follow: true },
  };
}

export default function PrivacyPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <Content locale={locale} />;
}

function Content({ locale }: { locale: string }) {
  const t = useTranslations('legal.privacy');
  return (
    <article className="prose prose-invert max-w-none space-y-4 text-sm">
      <h1 className="text-2xl font-semibold text-text-primary">{t('title')}</h1>
      <p className="text-xs text-text-muted">{t('lastUpdated')}</p>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-text-primary">{t('introTitle')}</h2>
        <p>{t('introBody')}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-text-primary">{t('dataCollectedTitle')}</h2>
        <p>{t('dataCollectedBody')}</p>
        <ul className="list-disc space-y-1 pl-5 text-text-secondary">
          <li>{t('dataItems.identity')}</li>
          <li>{t('dataItems.appointments')}</li>
          <li>{t('dataItems.payments')}</li>
          <li>{t('dataItems.technical')}</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-text-primary">{t('purposeTitle')}</h2>
        <p>{t('purposeBody')}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-text-primary">{t('retentionTitle')}</h2>
        <p>{t('retentionBody')}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-text-primary">{t('rightsTitle')}</h2>
        <p>{t('rightsBody')}</p>
        <ul className="list-disc space-y-1 pl-5 text-text-secondary">
          <li>{t('rightsItems.access')}</li>
          <li>{t('rightsItems.correction')}</li>
          <li>{t('rightsItems.deletion')}</li>
          <li>{t('rightsItems.portability')}</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-text-primary">{t('contactTitle')}</h2>
        <p>{t('contactBody')}</p>
      </section>

      <p className="pt-4 text-xs text-text-muted">
        <Link href={`/${locale}/terms`} className="text-accent hover:underline">
          {t('seeTerms')}
        </Link>
      </p>
    </article>
  );
}
