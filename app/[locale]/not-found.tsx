import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { FileQuestion } from 'lucide-react';

export default function LocaleNotFound() {
  const t = useTranslations('errors.notFound');
  // We can't read the active locale from inside not-found.tsx (no params),
  // so we hard-link to the locale-prefixed root and let the middleware sort it.
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg-base px-6 text-center">
      <FileQuestion className="h-10 w-10 text-text-muted" aria-hidden />
      <h1 className="text-2xl font-semibold text-text-primary">{t('title')}</h1>
      <p className="max-w-md text-sm text-text-secondary">{t('description')}</p>
      <Link
        href="/"
        className="mt-2 inline-flex h-10 items-center justify-center rounded bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
      >
        {t('home')}
      </Link>
    </div>
  );
}
