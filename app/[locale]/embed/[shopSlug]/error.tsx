'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import { captureException } from '@/lib/observability';

/**
 * Plan 038 (UX-07) — segment-level error boundary for the embed iframe. A
 * render/data failure used to bubble to the app-wide boundary (console-shaped,
 * wrong audience) inside the salon's website; this compact card keeps the
 * failure scoped to the widget and offers a retry.
 */
export default function EmbedError({ error, reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('pages.embed.error');

  useEffect(() => {
    captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-[320px] items-center justify-center bg-bg-base p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-lg bg-bg-surface px-6 py-10 text-center shadow-sm">
        <AlertTriangle className="h-8 w-8 text-warning" aria-hidden />
        <h1 className="text-base font-semibold text-text-primary">{t('title')}</h1>
        <p className="text-sm text-text-secondary">{t('body')}</p>
        <button
          type="button"
          onClick={reset}
          className="mt-1 inline-flex h-9 items-center justify-center rounded bg-accent px-4 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {t('retry')}
        </button>
      </div>
    </div>
  );
}
