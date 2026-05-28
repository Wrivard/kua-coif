/**
 * Sentry — Edge runtime init (middleware + Edge Route Handlers).
 *
 * Same DSN strategy as `sentry.server.config.ts`. The Edge runtime is more
 * restricted (no Node APIs), so Sentry uses a different transport here —
 * the `@sentry/nextjs` package handles that internally.
 */
import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from '@/lib/observability/sentry-scrub';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV;
  Sentry.init({
    dsn,
    // Phase 70 audit fix (Loop 17 follow-up) — same env-aware sample
    // rate as server.config + client.config. 0.1 in production, 1.0
    // everywhere else to keep the free 5k events/month tier alive.
    tracesSampleRate: env === 'production' ? 0.1 : 1.0,
    environment: env,
    // Phase H+1 — Loi 25 sub-processor compliance. Same scrubber +
    // same cyrb53 email hash as client + server runtimes.
    sendDefaultPii: false,
    beforeSend: scrubSentryEvent,
  });
}
