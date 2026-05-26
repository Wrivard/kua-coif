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
    title: locale === 'fr' ? "Conditions d'utilisation" : 'Terms of Service',
    robots: { index: true, follow: true },
  };
}

export default function TermsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <Content locale={locale} />;
}

function Content({ locale }: { locale: string }) {
  const t = useTranslations('legal.terms');
  return (
    <article className="prose prose-invert max-w-none space-y-4 text-sm">
      <h1 className="text-2xl font-semibold text-text-primary">{t('title')}</h1>
      <p className="text-xs text-text-muted">{t('lastUpdated')}</p>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-text-primary">{t('acceptanceTitle')}</h2>
        <p>{t('acceptanceBody')}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-text-primary">{t('serviceTitle')}</h2>
        <p>{t('serviceBody')}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-text-primary">{t('accountTitle')}</h2>
        <p>{t('accountBody')}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-text-primary">{t('cancellationTitle')}</h2>
        <p>{t('cancellationBody')}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-text-primary">{t('liabilityTitle')}</h2>
        <p>{t('liabilityBody')}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-text-primary">{t('lawTitle')}</h2>
        <p>{t('lawBody')}</p>
      </section>

      <p className="flex flex-wrap gap-x-4 gap-y-1 pt-4 text-xs text-text-muted">
        <Link href={`/${locale}/privacy`} className="text-accent hover:underline">
          {t('seePrivacy')}
        </Link>
        {/* Loop 38 (P117) — sibling link to the accessibility
            statement so all three legal surfaces stay reachable
            from each other. */}
        <Link href={`/${locale}/accessibility`} className="text-accent hover:underline">
          {locale === 'fr' ? 'Déclaration d’accessibilité →' : 'Accessibility statement →'}
        </Link>
      </p>
    </article>
  );
}
