'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { locales } from '@/i18n';
import { SETTINGS_NAV, stripLocale } from '@/lib/settings-nav';

/**
 * Loop 57 — Settings sub-sidebar.
 *
 * Renders the grouped list of /settings/* sections with active-state
 * highlighting. Desktop = persistent left rail. Mobile = `<select>` at
 * the top of the content area (1-tap navigation, native widget, fully
 * a11y). The desktop rail is hidden under `md:` and the select is
 * `md:hidden` so only one is ever visible at a time.
 *
 * Active matching is exact on `href` — no `startsWith` quirks since
 * each section is a leaf route (no nested sub-pages under any one of
 * them today).
 */
export function SettingsSidebar({ locale }: { locale: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('pages.settings.nav');
  const current = stripLocale(pathname, locales);

  return (
    <>
      {/* Mobile: native select. Cheap, accessible, no layout cost. */}
      <div className="border-b border-border bg-bg-base p-4 md:hidden">
        <label htmlFor="settings-section" className="sr-only">
          {t('title')}
        </label>
        <select
          id="settings-section"
          value={current}
          onChange={(e) => router.push(`/${locale}${e.target.value}`)}
          className="focus:ring-accent/30 h-10 w-full rounded-md border border-border bg-bg-surface px-3 text-sm text-text-primary focus:outline-none focus:ring-2"
        >
          {SETTINGS_NAV.flatMap((group) =>
            group.items.map((item) => (
              <option key={item.href} value={item.href}>
                {t(`items.${item.labelKey}`)}
              </option>
            )),
          )}
        </select>
      </div>

      {/* Desktop: persistent left rail. */}
      <nav aria-label={t('title')} className="hidden w-56 shrink-0 border-r border-border md:block">
        <div className="sticky top-[var(--header-h)] max-h-[calc(100vh-var(--header-h))] overflow-y-auto px-3 py-4">
          <ul className="space-y-6">
            {SETTINGS_NAV.map((group) => (
              <li key={group.labelKey}>
                <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  {t(`groups.${group.labelKey}`)}
                </p>
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = current === item.href;
                    return (
                      <li key={item.href}>
                        <Link
                          href={`/${locale}${item.href}`}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors',
                            active
                              ? 'bg-accent-subtle font-medium text-text-primary'
                              : 'text-text-secondary hover:bg-bg-surface-2 hover:text-text-primary',
                          )}
                        >
                          <span className="truncate">{t(`items.${item.labelKey}`)}</span>
                          {item.badge === 'new' ? (
                            <span className="bg-info/20 ml-2 inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-info">
                              {t('badges.new')}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </>
  );
}
