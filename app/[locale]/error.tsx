'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { captureException } from '@/lib/observability';

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors.boundary');

  useEffect(() => {
    captureException(error, { tags: { boundary: 'locale' } });
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg-base px-6 text-center">
      <AlertTriangle className="h-10 w-10 text-danger" aria-hidden />
      <h1 className="text-xl font-semibold text-text-primary">{t('title')}</h1>
      <p className="max-w-md text-sm text-text-secondary">{t('description')}</p>
      {error.digest ? (
        <p className="font-mono text-xs text-text-muted">digest: {error.digest}</p>
      ) : null}
      <Button onClick={reset}>{t('retry')}</Button>
    </div>
  );
}
