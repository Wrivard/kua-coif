import { headers } from 'next/headers';

/**
 * Best-effort client IP for rate limiting. Reads the first hop of
 * `x-forwarded-for` (Vercel and most proxies set it), falling back to
 * `x-real-ip`, then `'unknown'`.
 *
 * Two entry points:
 *   - no argument → reads the request's `headers()` (Server Actions / RSC);
 *   - a `Headers` argument → reads it directly (Route Handlers pass
 *     `req.headers`, where `headers()` from next/headers is not the request).
 *
 * Plan 025 (item a) — consolidates 6 verbatim copies plus several inline
 * variants that had DROPPED the `x-real-ip` fallback, which made IP-keyed
 * rate limits behave differently per endpoint.
 */
export function getClientIp(source?: Headers): string {
  const h = source ?? headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown';
}
