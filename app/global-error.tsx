'use client';

import './globals.css';
import { useEffect } from 'react';
import { captureException } from '@/lib/observability';

/**
 * Last-resort error boundary. Catches errors thrown above the locale layout
 * (e.g. when next-intl itself fails to initialize) — so we cannot rely on
 * next-intl here. We pick a language from the browser's `navigator.language`
 * with French as the default (matching the rest of the app).
 *
 * `useEffect` is only used to forward to Sentry (Phase 9). Strings live in a
 * small inline table to keep this file self-contained.
 */
const fallbackStrings = {
  fr: {
    title: 'Quelque chose s’est mal passé',
    description:
      'Une erreur inattendue est survenue. Recharge la page ; si le problème persiste, contacte le support.',
    retry: 'Réessayer',
    digest: 'identifiant',
  },
  en: {
    title: 'Something went wrong',
    description:
      'An unexpected error occurred. Please reload the page; if the issue persists, contact support.',
    retry: 'Try again',
    digest: 'digest',
  },
} as const;

function pickLocale(): 'fr' | 'en' {
  if (typeof navigator === 'undefined') return 'fr';
  const lang = navigator.language?.slice(0, 2).toLowerCase();
  return lang === 'en' ? 'en' : 'fr';
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const lang = pickLocale();
  const t = fallbackStrings[lang];

  useEffect(() => {
    captureException(error, { tags: { boundary: 'global' } });
  }, [error]);

  return (
    <html lang={lang} className="dark">
      <body className="min-h-screen bg-bg-base text-text-primary antialiased">
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="text-2xl font-semibold">{t.title}</h1>
          <p className="max-w-md text-sm text-text-secondary">{t.description}</p>
          {error.digest ? (
            <p className="font-mono text-xs text-text-muted">
              {t.digest}: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
          >
            {t.retry}
          </button>
        </main>
      </body>
    </html>
  );
}
