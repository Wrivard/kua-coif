/**
 * Loop 57 — Settings sub-nav model.
 *
 * The /settings/* tree has 16 sub-routes today (all of them shipped, none
 * of them linked anywhere — `/settings/widget`, `/settings/payments`,
 * `/settings/notifications`, etc. were direct-URL only until now). This
 * data drives the sub-sidebar rendered by `app/[locale]/(app)/settings/
 * layout.tsx`.
 *
 * Mirrors the structure of `lib/nav-items.ts` (data here, presentation
 * + active-state tracking in the component). i18n labels live under
 * `pages.settings.nav.*` in messages.
 *
 * `active-shop` is intentionally NOT listed: that surface is reached via
 * the main-sidebar shop-switcher (Loop 39). Surfacing it twice would
 * confuse single-shop users who don't need a switcher at all.
 */

export type SettingsNavItem = {
  /** Path without locale prefix. */
  href: string;
  /** i18n key under `pages.settings.nav.items.*`. */
  labelKey: string;
  /** Optional badge — kept tiny (just 'new' for now matching the SPEC). */
  badge?: 'new';
};

export type SettingsNavGroup = {
  /** i18n key under `pages.settings.nav.groups.*`. */
  labelKey: string;
  items: SettingsNavItem[];
};

export const SETTINGS_NAV: ReadonlyArray<SettingsNavGroup> = [
  {
    labelKey: 'shop',
    items: [
      { href: '/settings/shop', labelKey: 'shopDetails' },
      // SPEC explicitly calls out the "New" badge on User Settings (Image 1
      // of the Squire reference). Keeping the pilule until users-settings
      // hits feature-parity with the rest of the menu.
      { href: '/settings/users', labelKey: 'users', badge: 'new' },
    ],
  },
  {
    labelKey: 'operations',
    items: [
      { href: '/settings/barbers', labelKey: 'barberSettings' },
      { href: '/settings/commissions', labelKey: 'commissions' },
      { href: '/settings/waiting-list', labelKey: 'waitingList' },
    ],
  },
  {
    labelKey: 'pricing',
    items: [
      { href: '/settings/taxes', labelKey: 'taxes' },
      // SM-07 — the `discounts` table is never applied at pricing (only promo
      // codes are), so the page is hidden from the nav (still reachable by URL,
      // backend untouched) until it gets a transactional outlet.
      { href: '/settings/loyalty', labelKey: 'loyalty' },
      { href: '/settings/promo-codes', labelKey: 'promoCodes' },
    ],
  },
  {
    labelKey: 'integrations',
    items: [
      { href: '/settings/notifications', labelKey: 'notifications' },
      { href: '/settings/payments', labelKey: 'payments' },
      { href: '/settings/widget', labelKey: 'widget' },
      { href: '/settings/reviews', labelKey: 'reviewsModeration' },
    ],
  },
  {
    labelKey: 'security',
    items: [
      { href: '/settings/password', labelKey: 'password' },
      { href: '/settings/two-factor', labelKey: 'twoFactor' },
    ],
  },
  {
    labelKey: 'audit',
    items: [{ href: '/settings/audit-log', labelKey: 'auditLog' }],
  },
];

/** Strip the locale segment for active-state matching. Mirrors
 *  `stripLocale` in `lib/nav-items.ts`. */
export function stripLocale(pathname: string, locales: ReadonlyArray<string>): string {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return '/';
  if (locales.includes(segments[0]!)) {
    const rest = segments.slice(1).join('/');
    return rest ? `/${rest}` : '/';
  }
  return pathname || '/';
}
