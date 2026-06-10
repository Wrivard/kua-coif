import { setRequestLocale } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import type { Metadata } from 'next';
import Link from 'next/link';

export const dynamic = 'force-static';

/**
 * Loop 38 (Phase 117 from AUDIT_PHASE70) — WCAG accessibility
 * statement. A public page that:
 *
 *   1. Declares Küa's target conformance level (WCAG 2.1 AA)
 *   2. Lists known limitations + their resolution timeline
 *   3. Provides a contact path for reporting access barriers
 *
 * Static FR/EN content kept inside the `legal.accessibility`
 * namespace — same surface as /privacy and /terms so the legal
 * footer can link to all three uniformly. The page itself is
 * `force-static` since the content doesn't change per request.
 *
 * The companion `tests/e2e/a11y.spec.ts` axe-core test runs against
 * the same surfaces this statement promises to keep accessible
 * (login, public booking wizard, this statement page itself) — so
 * any code change that drops below the WCAG 2.1 AA bar fails CI.
 */
export async function generateMetadata(props: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const params = await props.params;

  const { locale } = params;

  return {
    title: locale === 'fr' ? 'Déclaration d’accessibilité' : 'Accessibility statement',
    robots: { index: true, follow: true },
  };
}

export default async function AccessibilityPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  return <Content locale={locale} />;
}

function Content({ locale }: { locale: string }) {
  const t = useTranslations('legal.accessibility');
  return (
    <article className="prose prose-invert max-w-none space-y-4 text-sm">
      <h1 className="text-2xl font-semibold text-text-primary">{t('title')}</h1>
      <p className="text-xs text-text-muted">{t('lastUpdated')}</p>

      <section className="space-y-3 text-text-secondary">
        <p>{t('commitment')}</p>

        <h2 className="text-lg font-semibold text-text-primary">{t('standardTitle')}</h2>
        <p>{t('standardBody')}</p>

        <h2 className="text-lg font-semibold text-text-primary">{t('measuresTitle')}</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>{t('measures.contrast')}</li>
          <li>{t('measures.keyboard')}</li>
          <li>{t('measures.aria')}</li>
          <li>{t('measures.ci')}</li>
        </ul>

        <h2 className="text-lg font-semibold text-text-primary">{t('limitationsTitle')}</h2>
        <p>{t('limitationsIntro')}</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>{t('limitations.calendarDnd')}</li>
          <li>{t('limitations.thirdParty')}</li>
        </ul>

        <h2 className="text-lg font-semibold text-text-primary">{t('reportTitle')}</h2>
        <p>
          {t.rich('reportBody', {
            email: (chunks) => (
              <a
                href="mailto:wrivard@kua.quebec"
                className="text-accent underline hover:no-underline"
              >
                {chunks}
              </a>
            ),
          })}
        </p>
      </section>

      <p className="flex flex-wrap gap-x-4 gap-y-1 pt-4 text-xs text-text-muted">
        <Link href={`/${locale}/privacy`} className="text-accent hover:underline">
          {locale === 'fr' ? 'Politique de confidentialité →' : 'Privacy Policy →'}
        </Link>
        <Link href={`/${locale}/terms`} className="text-accent hover:underline">
          {locale === 'fr' ? "Conditions d'utilisation →" : 'Terms of Service →'}
        </Link>
      </p>
    </article>
  );
}
