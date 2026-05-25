'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { captureException } from '@/lib/observability';

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
    captureException(error, { tags: { boundary: 'app-shell' } });
  }, [error]);

  return (
    <div className="p-6">
      <EmptyState
        tone="danger"
        icon={<AlertTriangle className="h-7 w-7" />}
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
