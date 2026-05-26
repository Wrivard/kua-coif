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
  const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV;
  Sentry.init({
    dsn,
    // Phase 70 audit fix: production sample rate dropped from 1.0 to
    // 0.1. The previous 100% would burn through the free 5k events/mo
    // tier in days on any real shop. Dev/preview stay at 1.0 so we
    // still catch everything during testing.
    tracesSampleRate: env === 'production' ? 0.1 : 1.0,
    environment: env,
  });
}
