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
        {/* Loop 57 SR — <optgroup> preserves the group context (Shop /
         *  Operations / Pricing / …) that the desktop rail shows as
         *  headers. Without it, mobile users see a 16-item flat list
         *  with no visual hierarchy. */}
        <select
          id="settings-section"
          value={current}
          onChange={(e) => router.push(`/${locale}${e.target.value}`)}
          className="h-10 w-full rounded-md border border-border bg-bg-surface px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
        >
          {SETTINGS_NAV.map((group) => (
            <optgroup key={group.labelKey} label={t(`groups.${group.labelKey}`)}>
              {group.items.map((item) => (
                <option key={item.href} value={item.href}>
                  {t(`items.${item.labelKey}`)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Desktop: persistent left rail.
       *
       *  Loop 57 SR — moved `sticky top-0` to the OUTER nav (was on
       *  the inner div). The inner-div approach broke once the outer
       *  scrolled out of view (sticky has nothing to anchor to after
       *  its parent leaves the viewport). `self-start` is critical:
       *  flex items stretch to row-height by default, which would
       *  pin the sub-sidebar to content height and defeat sticky.
       *  PageHeader inside the content column is also `sticky top-0
       *  z-30` so the two stick side-by-side without overlapping. */}
      <nav
        aria-label={t('title')}
        className="hidden w-56 shrink-0 self-start border-r border-border md:sticky md:top-0 md:block md:max-h-screen md:overflow-y-auto"
      >
        <div className="px-3 py-4">
          <ul className="space-y-6">
            {SETTINGS_NAV.map((group) => (
              <li key={group.labelKey}>
                <p className="type-eyebrow mb-2 px-2">{t(`groups.${group.labelKey}`)}</p>
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = current === item.href;
                    return (
                      <li key={item.href}>
                        <Link
                          href={`/${locale}${item.href}`}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'relative flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-all duration-150 ease-out-quint',
                            active
                              ? 'bg-bg-surface-2 font-medium text-text-primary shadow-sm'
                              : 'text-text-secondary hover:bg-bg-surface-2 hover:text-text-primary',
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-accent transition-opacity duration-150',
                              active ? 'opacity-100' : 'opacity-0',
                            )}
                          />
                          <span className="truncate pl-1">{t(`items.${item.labelKey}`)}</span>
                          {item.badge === 'new' ? (
                            <span className="ml-2 inline-flex items-center rounded-full bg-info/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-info">
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
