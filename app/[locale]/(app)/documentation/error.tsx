'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { captureException } from '@/lib/observability';

/**
 * Route-segment error boundary for /documentation. Scopes a render failure to
 * the docs browser — the sidebar + page header stay alive, only the contents
 * are replaced. Tags the Sentry capture so a documentation failure is
 * distinguishable in the dashboard. Reuses the shared `errors.boundary`
 * strings (no new i18n keys).
 */
export default function DocumentationError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors.boundary');

  useEffect(() => {
    captureException(error, { tags: { boundary: 'documentation' } });
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
