/**
 * Centralized observability hook.
 *
 * Today this is a thin wrapper around `console.error` (dev) / no-op (prod).
 * When you're ready to plug Sentry in:
 *
 *   1. `npm install @sentry/nextjs`
 *   2. `npx @sentry/wizard@latest -i nextjs` (creates sentry.{client,server,edge}.config.ts)
 *   3. Replace the `captureException` / `captureMessage` bodies below with
 *      `import * as Sentry from '@sentry/nextjs'` + `Sentry.captureException(...)`.
 *   4. Set `SENTRY_DSN` (server) and `NEXT_PUBLIC_SENTRY_DSN` (client) in env.
 *
 * Keeping every error/log path going through this module means we never have
 * to grep the codebase for `console.error` again when we switch backends.
 */

type Context = {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: { id?: string; email?: string };
};

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN;

export function captureException(error: unknown, context?: Context) {
  // Phase 9 placeholder:
  //   if (DSN) Sentry.captureException(error, { tags: context?.tags, extra: context?.extra });
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error('[observability] captureException', error, context ?? '');
  }
  // Mark DSN as intentionally read so unused-var lint doesn't trigger.
  void DSN;
}

export function captureMessage(message: string, context?: Context) {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log('[observability] captureMessage', message, context ?? '');
  }
}

/** Tag the current Sentry scope with the active user (call from layouts/middleware). */
export function setUser(user: { id: string; email?: string } | null) {
  // Phase 9: Sentry.setUser(user);
  void user;
}
