'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

/**
 * Phase 70 audit fix (Loop 18) — wire Sentry's user context on the
 * BROWSER scope so client-side errors carry "who was logged in" too.
 *
 * The server-side scope is set in `app/[locale]/(app)/layout.tsx` via
 * `setUser({id, email})` from `lib/observability.ts` — that runs on
 * the server scope per-request. Sentry's client and server scopes are
 * independent; client errors (React error boundaries, network fetches,
 * runtime exceptions in components) need their own setUser call.
 *
 * This component takes the id+email already resolved server-side
 * (cheap — no extra round-trip) and tags the client scope via
 * `Sentry.setUser` in a `useEffect`. The effect re-fires if the user
 * changes (e.g., switching shops in a long-lived tab). On unmount /
 * sign-out, we clear the tag.
 *
 * Safe no-op when no Sentry DSN is configured — Sentry.setUser is a
 * no-op when init() didn't run.
 */
export function SentryUserInit({ id, email }: { id: string | null; email: string | null }) {
  useEffect(() => {
    if (id) {
      Sentry.setUser({ id, email: email ?? undefined });
    } else {
      Sentry.setUser(null);
    }
    return () => {
      // Clear on unmount so a stale identity doesn't follow the user
      // into a new session (e.g., after a sign-out the layout
      // re-renders without the user prop).
      Sentry.setUser(null);
    };
  }, [id, email]);
  return null;
}
