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

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Sample rates: aggressive in V1 because we want to see what's happening
    // post-launch. Drop to ~0.1 once we're confident.
    tracesSampleRate: 1.0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.1,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    // Filter out the noise from the Vercel toolbar that our CSP already
    // blocks (cf. console warnings in the live deployment).
    denyUrls: [/vercel\.live\/_next-live\/feedback/],
  });
}
