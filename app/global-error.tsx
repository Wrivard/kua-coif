'use client';

import './globals.css';

/**
 * Last-resort error boundary. Catches errors thrown above the locale layout
 * (e.g. when next-intl itself fails to initialize). No i18n, no design tokens
 * beyond what globals.css provides.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bg-base text-text-primary antialiased">
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="max-w-md text-sm text-text-secondary">
            An unexpected error occurred. Please reload the page; if the issue persists, contact
            support.
          </p>
          {error.digest ? <p className="font-mono text-xs text-text-muted">digest: {error.digest}</p> : null}
          <button
            type="button"
            onClick={reset}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
