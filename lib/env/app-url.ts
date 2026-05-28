/**
 * Phase H — single source of truth for `NEXT_PUBLIC_APP_URL`.
 *
 * The env var drives the absolute base for every signed URL the system
 * mints (booking confirmation `/me` link, receipt page, reschedule, review).
 * When it's missing in production, those links become relative paths
 * embedded in plaintext email — which most clients render as broken or
 * mailto-prefixed nonsense. Customer can't self-cancel; owner has to
 * field calls instead.
 *
 * This helper:
 *   - returns the trimmed value when set
 *   - logs a one-time Sentry warning in production when missing (so the
 *     operator notices BEFORE the customer complains)
 *   - returns `''` so callers don't have to nullcheck — the broken-URL
 *     surfaces in tests + manual inspection
 *
 * The Sentry log only fires once per cold-start to avoid noise, but each
 * fresh serverless instance will re-warn so we don't go silent forever.
 */
import { captureException } from '@/lib/observability';

let warnedAt: number | null = null;

export function appUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL;
  if (raw) return raw.replace(/\/$/, '');
  // Only warn once per instance to avoid spamming Sentry on hot paths.
  if (process.env.NODE_ENV === 'production' && warnedAt == null) {
    warnedAt = Date.now();
    captureException(
      new Error(
        'NEXT_PUBLIC_APP_URL is not set — signed URLs in customer emails will be relative and broken. Set this env var to the production base URL.',
      ),
      { tags: { layer: 'env', missing: 'NEXT_PUBLIC_APP_URL' } },
    );
  }
  return '';
}
