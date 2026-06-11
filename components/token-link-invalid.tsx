import { useTranslations } from 'next-intl';
import { Link2Off } from 'lucide-react';

/**
 * Plan 037 (UX-01) — shared landing for the five token-gated segments
 * (me | review | receipt | reschedule | unsubscribe). A customer tapping a
 * week-old "move my appointment" email used to dead-end on the generic Küa
 * 404 with a "Go home" button into a SaaS they've never heard of.
 *
 * Deliberately minimal:
 *  - NO home link — the Küa root means nothing to a salon's customer.
 *  - NO enumeration of causes — invalid, expired and revoked must stay
 *    indistinguishable so the page can't be used as a token oracle.
 *
 * Locale comes from the next-intl request context (not-found boundaries
 * receive no params — same approach as `app/[locale]/not-found.tsx`).
 */
export function TokenLinkInvalid() {
  const t = useTranslations('pages.tokenLink');
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg-base px-6 text-center">
      <Link2Off className="h-10 w-10 text-text-muted" aria-hidden />
      <h1 className="text-2xl font-semibold text-text-primary">{t('title')}</h1>
      <p className="max-w-md text-sm text-text-secondary">{t('description')}</p>
    </div>
  );
}
