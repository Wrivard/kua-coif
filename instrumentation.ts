/**
 * Next.js Instrumentation hook — loaded once per process at boot. Lets us
 * register init code that needs to run before any request is served.
 *
 * Here it's used to side-load the Sentry runtime config files (`server` for
 * Node, `edge` for the Vercel Edge runtime). The client-side init lives in
 * `sentry.client.config.ts` and is wired separately by `@sentry/nextjs`'s
 * webpack plugin.
 *
 * Both configs are DSN-gated, so this hook is effectively a no-op when no
 * Sentry DSN is set.
 */
export async function register() {
  // Observability guard — a production deploy with NO Sentry DSN silently
  // reports nothing, so every server error (incl. the calendar's load-error
  // throw) is invisible. Warn loudly at boot rather than hard-failing, since
  // Sentry-free environments are legitimate; a CI gate can promote this to an
  // error for prod builds if desired.
  if (
    process.env.NODE_ENV === 'production' &&
    !process.env.SENTRY_DSN &&
    !process.env.NEXT_PUBLIC_SENTRY_DSN
  ) {
    console.warn(
      '[observability] No Sentry DSN set in a production build — server errors will not be reported.',
    );
  }
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

/**
 * Capture Server Component render errors and dispatch them to Sentry. The
 * SDK exports a typed helper for exactly this hook signature.
 */
export { captureRequestError as onRequestError } from '@sentry/nextjs';
