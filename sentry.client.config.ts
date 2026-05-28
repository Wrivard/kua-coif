/**
 * Sentry — browser runtime init.
 *
 * Sentry is wired but **inactive until** a DSN is provided. To turn it on:
 *   1. Create a free Sentry project (5k events/mo) at https://sentry.io.
 *   2. Copy the DSN into `NEXT_PUBLIC_SENTRY_DSN` (Vercel env, both Preview
 *      and Production).
 *   3. Redeploy — the next page load will start sending events.
 *
 * Without a DSN, `Sentry.init` is skipped entirely so the SDK never sets up
 * its global listeners. Zero runtime overhead in that case (the import is
 * already paid for at bundle time).
 */
import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from '@/lib/observability/sentry-scrub';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  const env = process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV;
  Sentry.init({
    dsn,
    // Phase 70 audit fix: production sample rate dropped from 1.0 to
    // 0.1 to stay within the free 5k events/mo tier. Dev/preview stay
    // at 1.0 so we still catch everything during QA.
    tracesSampleRate: env === 'production' ? 0.1 : 1.0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.1,
    environment: env,
    // Phase H+1 — Loi 25 sub-processor compliance. Strips known PII
    // keys before send. Email is replaced with a stable cyrb53 hash
    // (irreversible in practice + pivotable across requests).
    sendDefaultPii: false,
    beforeSend: scrubSentryEvent,
    // Filter out the noise from the Vercel toolbar that our CSP already
    // blocks (cf. console warnings in the live deployment).
    denyUrls: [/vercel\.live\/_next-live\/feedback/],
  });
}
