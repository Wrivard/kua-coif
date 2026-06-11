'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { Bug, LayoutDashboard, Settings2, Store } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Phase H+9 — secondary nav rail for the super-admin section.
 *
 * Sits directly under PageHeader on every /super-admin/* page so a
 * Küa team member can jump between Overview / Shops / Platform config
 * / Auto-fix without scrolling back to the dashboard cards. Sticky at
 * `top-header-h` so it stays reachable while the page body scrolls.
 *
 * Active state matches by `startsWith` except for the root Overview
 * link, which requires an exact path match (otherwise it would light
 * up on every sub-page since they all start with `/super-admin`).
 *
 * Client component so usePathname resolves at render time; the parent
 * server pages pass `locale` through props.
 */

type NavItem = {
  /** Path segment appended to `/{locale}/super-admin`. Empty = root. */
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
};

const NAV: NavItem[] = [
  { href: '', label: 'Overview', icon: LayoutDashboard },
  { href: '/shops', label: 'Shops', icon: Store },
  { href: '/platform-config', label: 'Configuration', icon: Settings2 },
  { href: '/sentry-autofix', label: 'Auto-fix', icon: Bug },
];

export function SuperAdminNav() {
  // Read locale from the route params so callers don't need to thread
  // it through props. `useParams` returns `string | string[]` so we
  // narrow + fall back defensively.
  const params = useParams();
  const localeParam = params?.locale;
  const locale =
    typeof localeParam === 'string'
      ? localeParam
      : Array.isArray(localeParam)
        ? localeParam[0]
        : 'fr';
  const pathname = usePathname();
  const base = `/${locale}/super-admin`;

  return (
    <div className="sticky top-header-h z-20 border-b border-border bg-bg-base/80 backdrop-blur-xl">
      <nav
        aria-label="Super-admin secondary navigation"
        className="flex gap-1 overflow-x-auto px-6"
      >
        {NAV.map((item) => {
          const href = `${base}${item.href}`;
          // Overview = exact match; everything else = startsWith so
          // /super-admin/shops/[id] still highlights "Shops" and
          // /super-admin/platform-config/history still highlights
          // "Configuration".
          const active =
            item.href === ''
              ? pathname === base
              : pathname === href || pathname.startsWith(`${href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-xs font-medium transition-colors duration-150',
                active
                  ? 'border-text-primary text-text-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
