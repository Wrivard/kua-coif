import { timingSafeEqual } from 'node:crypto';

/**
 * Shared authorization for cron route handlers.
 *
 * Cron routes are service-role mass-action endpoints (send email/SMS, refresh
 * OAuth tokens, renew Google channels), so an unauthenticated caller is a real
 * risk. Each route previously inlined `if (!secret) return true`, which left
 * these endpoints WIDE OPEN on any deploy that forgot to set CRON_SECRET.
 *
 *   - In PRODUCTION, a missing CRON_SECRET is fail-CLOSED (deny).
 *   - Outside production (dev/test), a missing secret runs unprotected so local
 *     runs don't need the header.
 *   - The bearer token is compared in constant time.
 *
 * The GitHub Actions cron workflows pass the secret, so production stays green;
 * this only closes the non-Vercel / preview / misconfigured-deploy hole.
 */
export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return process.env.NODE_ENV !== 'production';
  }
  const header = req.headers.get('authorization');
  if (!header) return false;
  return safeEqual(header, `Bearer ${secret}`);
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
