import { setRequestLocale } from 'next-intl/server';
import { useTranslations } from 'next-intl';

type Props = {
  params: { locale: string };
};

export default function HomePage({ params: { locale } }: Props) {
  setRequestLocale(locale);
  return <HomeContent />;
}

function HomeContent() {
  const t = useTranslations('home');
  const tApp = useTranslations('app');

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-start justify-center gap-6 px-6">
      <span className="rounded-full bg-accent-subtle px-3 py-1 text-xs font-semibold uppercase tracking-wide text-accent">
        {t('phaseStatus')}
      </span>
      <h1 className="text-4xl font-semibold text-text-primary">
        {t('title')} <span className="text-accent">{tApp('name')}</span>
      </h1>
      <p className="max-w-xl text-base leading-relaxed text-text-secondary">
        {tApp('tagline')}.
      </p>
      <p className="text-sm text-text-muted">{t('subtitle')}</p>
    </main>
  );
}
