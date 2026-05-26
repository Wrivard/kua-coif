'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from './button';

/**
 * Loop 48 (Phase 118 from AUDIT_PHASE70) — public cookie banner.
 *
 * Today the Küa stack uses ONLY strictly-necessary cookies (Supabase
 * Auth session + `kua_active_shop` shop selector), so under both
 * GDPR ePrivacy and Quebec Loi 25 a banner isn't strictly required.
 * We ship it anyway as a trust signal: a customer landing on
 * /book/[shopSlug] from a Google search expects to see SOME
 * privacy-aware affordance, and a missing banner reads as either
 * "this site is sloppy" or "this site is hiding tracking."
 *
 * Behaviour:
 *   - Reads a 1-year `kua_cookie_consent` cookie on mount; renders
 *     nothing if it's already set (any value — we don't gate
 *     features behind it today, so the binary "decided / not yet"
 *     is enough).
 *   - "Accept all" sets `kua_cookie_consent=accepted`; the value is
 *     reserved for a future loop that wires analytics behind it.
 *   - "Reject optional" sets `kua_cookie_consent=essential_only` —
 *     same outward behaviour today since we have nothing optional
 *     to disable.
 *   - Links to the existing /privacy page for the full policy.
 *
 * Mounted at the root of the public layouts (booking wizard, legal
 * pages, login). Auth'd shells skip it — the manager already has a
 * cookie set by the act of signing in, so the banner would be
 * noise.
 */
export function CookieBanner({ locale }: { locale: string }) {
  const t = useTranslations('legal.cookieBanner');
  // `null` while we read the cookie (avoids a flash of the banner on
  // pages where the user already consented). Once we know the
  // state, `true` shows the banner and `false` keeps it hidden.
  const [visible, setVisible] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const hasConsent = document.cookie
      .split(';')
      .some((c) => c.trim().startsWith('kua_cookie_consent='));
    setVisible(!hasConsent);
  }, []);

  function setConsent(value: 'accepted' | 'essential_only') {
    if (typeof document === 'undefined') return;
    // 1-year expiry — re-prompt yearly so an inactive customer
    // doesn't carry a stale choice forever. `SameSite=Lax` matches
    // the rest of our cookies. `Secure` in prod via the Next.js
    // runtime cookie defaults.
    const oneYear = 60 * 60 * 24 * 365;
    document.cookie = `kua_cookie_consent=${value}; Path=/; Max-Age=${oneYear}; SameSite=Lax${
      window.location.protocol === 'https:' ? '; Secure' : ''
    }`;
    setVisible(false);
  }

  if (visible !== true) return null;

  return (
    <div
      role="region"
      aria-label={t('aria')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg-surface px-4 py-4 shadow-lg sm:px-6"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-text-secondary">
          {t.rich('body', {
            link: (chunks) => (
              <Link
                href={`/${locale}/privacy`}
                className="text-accent underline hover:no-underline"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConsent('essential_only')}
          >
            {t('reject')}
          </Button>
          <Button type="button" size="sm" onClick={() => setConsent('accepted')}>
            {t('accept')}
          </Button>
        </div>
      </div>
    </div>
  );
}
