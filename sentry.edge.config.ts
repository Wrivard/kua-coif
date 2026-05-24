/**
 * Sentry — Edge runtime init (middleware + Edge Route Handlers).
 *
 * Same DSN strategy as `sentry.server.config.ts`. The Edge runtime is more
 * restricted (no Node APIs), so Sentry uses a different transport here —
 * the `@sentry/nextjs` package handles that internally.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 1.0,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  });
}
