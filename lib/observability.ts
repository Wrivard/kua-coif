/**
 * Centralized observability hook — every error / log / user-tag in the app
 * flows through this module so we have one place to swap backends.
 *
 * Wired to `@sentry/nextjs` (added in Phase 13). The Sentry SDK is imported
 * eagerly because tree-shaking can't statically prove the imports are unused;
 * the SDK itself is a no-op at runtime when `NEXT_PUBLIC_SENTRY_DSN` /
 * `SENTRY_DSN` are not set (see `sentry.{client,server,edge}.config.ts`).
 *
 * **Activation flow** (the only thing left for the user):
 *   1. Create a free Sentry project (5k events/mo).
 *   2. Set `NEXT_PUBLIC_SENTRY_DSN` (browser) and `SENTRY_DSN` (server) in
 *      Vercel + local `.env.local`.
 *   3. Redeploy. New errors are captured on the next page load.
 *
 * `captureException` and `captureMessage` keep working in dev (and during
 * deploys without a DSN); they just log to `console` instead.
 */
import * as Sentry from '@sentry/nextjs';

type Context = {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: { id?: string; email?: string };
};

function sentryEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN);
}

export function captureException(error: unknown, context?: Context) {
  if (sentryEnabled()) {
    Sentry.captureException(error, {
      tags: context?.tags,
      extra: context?.extra,
      user: context?.user,
    });
    return;
  }
  // Dev fallback: surface to the terminal so we don't lose the signal while
  // Sentry is dormant. Production builds with no DSN swallow everything —
  // which is the intended behavior (we don't want noisy console.errors
  // streaming to a real user's devtools).
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error('[observability] captureException', error, context ?? '');
  }
}

export function captureMessage(message: string, context?: Context) {
  if (sentryEnabled()) {
    Sentry.captureMessage(message, {
      tags: context?.tags,
      extra: context?.extra,
      user: context?.user,
    });
    return;
  }
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log('[observability] captureMessage', message, context ?? '');
  }
}

/**
 * Tag the active Sentry scope with the signed-in user. Call once after auth
 * resolves (e.g. from a layout that already loads the session). `null` clears
 * any previous tag — use it on sign-out.
 */
export function setUser(user: { id: string; email?: string } | null) {
  if (!sentryEnabled()) return;
  if (user) Sentry.setUser({ id: user.id, email: user.email });
  else Sentry.setUser(null);
}
