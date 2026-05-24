'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

// Local error boundary for the authenticated app shell. Keeps the sidebar/page
// header alive, only the page contents are replaced with this fallback.
export default function AppShellError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors.boundary');

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.error('Shell error boundary caught:', error);
    }
  }, [error]);

  return (
    <div className="p-6">
      <EmptyState
        icon={<AlertTriangle className="h-8 w-8 text-danger" />}
        title={t('title')}
        description={
          <>
            {t('description')}
            {error.digest ? (
              <>
                {' '}
                <span className="font-mono text-xs text-text-muted">({error.digest})</span>
              </>
            ) : null}
          </>
        }
        action={<Button onClick={reset}>{t('retry')}</Button>}
      />
    </div>
  );
}
