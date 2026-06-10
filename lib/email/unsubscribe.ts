import { signToken } from '@/lib/security/signed-tokens';
import { appUrl } from '@/lib/env/app-url';

/**
 * CASL unsubscribe link builder (Clients audit W6b).
 *
 * Every commercial electronic message (CEM) — win-back, birthday,
 * review request — must carry a working unsubscribe mechanism. This is
 * the single place that mints the signed `unsub` token and formats the
 * public opt-out URL, so all three send paths stay consistent.
 *
 * TTL = 365 days. Unsubscribe links must keep working long after the
 * email was sent — a client may open a months-old message and still
 * expect the opt-out to land — and 365 days comfortably exceeds CASL's
 * 60-day-minimum validity for an unsubscribe mechanism. A leaked unsub
 * token is low-risk: the only thing it can do is opt a client OUT of
 * marketing (the privacy-preserving direction), which an admin can
 * reverse from the client's fiche.
 */
const UNSUB_TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;

/**
 * Absolute URL to the public /unsubscribe/[token] page for a client.
 * Falls back to a relative path when NEXT_PUBLIC_APP_URL is unset
 * (broken link beats no link), matching the review/booking URL builders.
 */
export function buildUnsubscribeUrl(clientId: string, locale: 'fr' | 'en'): string {
  const base = appUrl();
  const token = signToken({
    kind: 'unsub',
    resourceId: clientId,
    expiresInSeconds: UNSUB_TOKEN_TTL_SECONDS,
  });
  return `${base}/${locale}/unsubscribe/${encodeURIComponent(token)}`;
}
