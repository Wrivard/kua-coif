/**
 * Sentry — Node.js server runtime init (Server Components, Route Handlers,
 * Server Actions). See `sentry.client.config.ts` for the activation flow.
 *
 * `SENTRY_DSN` (server-only) is used when set; we fall back to the public
 * DSN since they typically point at the same project — having one is enough
 * for V1. V1.1 can split them if we want different sample rates or PII
 * scrubbing rules between client and server.
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
