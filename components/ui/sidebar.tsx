'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ChevronsLeft, ChevronsRight, Globe, LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { isItemActive, NAV_ITEMS, stripLocale, type NavItem } from '@/lib/nav-items';
import { locales } from '@/i18n';
import { signOutAction } from '@/lib/auth/actions';

export type SidebarUser = {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
};

type Props = {
  locale: string;
  user: SidebarUser | null;
  /**
   * Industry feature flag (Phase 23): when true, the Products nav item is
   * hidden — therapy verticals (massage / physio / chiro) typically don't
   * sell retail products. Default `false` preserves V1 behavior.
   */
  hideProducts?: boolean;
};

/**
 * Desktop sidebar — `hidden md:flex` so it's only visible on `>= md` screens.
 * On smaller viewports, `<MobileSidebar>` (separate file) provides the same
 * navigation behind a hamburger trigger. Both share `<SidebarNavInner>` so
 * the nav item rendering, locale switcher, and logout button stay consistent.
 */
export function Sidebar({ locale, user, hideProducts = false }: Props) {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const [expanded, setExpanded] = useState(false);

  const currentPath = stripLocale(pathname, locales);

  return (
    <aside
      className={cn(
        // hidden md:flex — see component-level comment. On mobile the
        // matching <MobileSidebar> handles navigation via a hamburger
        // overlay.
        'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-bg-surface transition-[width] duration-200 ease-in-out md:flex',
        expanded ? 'w-sidebar-w-open' : 'w-sidebar-w',
      )}
      aria-label="Primary navigation"
    >
      <div className="flex h-header-h items-center justify-between border-b border-border px-3">
        <Link
          href={`/${locale}/`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-accent text-accent-fg"
          aria-label="Küa"
        >
          <span className="text-sm font-bold">K</span>
        </Link>
        {expanded ? (
          <span className="ml-2 truncate text-sm font-semibold text-text-primary">Küa</span>
        ) : null}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? t('collapseSidebar') : t('expandSidebar')}
          className="rounded p-1 text-text-muted transition-colors hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {expanded ? <ChevronsLeft className="h-4 w-4" /> : <ChevronsRight className="h-4 w-4" />}
        </button>
      </div>

      <SidebarNavInner
        locale={locale}
        user={user}
        currentPath={currentPath}
        expanded={expanded}
        hideProducts={hideProducts}
      />
    </aside>
  );
}

/**
 * Shared nav rendering used by both `<Sidebar>` (desktop, collapsible) and
 * `<MobileSidebar>` (mobile, always-expanded inside a drawer overlay).
 *
 * `expanded` drives label visibility — collapsed mode shows icons only,
 * expanded mode shows icons + labels. Mobile passes `expanded` because the
 * drawer is wide enough for full labels.
 *
 * `onNavigate` lets the mobile drawer close itself after a nav click.
 * Desktop passes nothing (no closing needed — sidebar stays open).
 */
export function SidebarNavInner({
  locale,
  user,
  currentPath,
  expanded,
  hideProducts = false,
  onNavigate,
}: {
  locale: string;
  user: SidebarUser | null;
  currentPath: string;
  expanded: boolean;
  hideProducts?: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations('nav');
  const localePrefix = `/${locale}`;
  const navItems = hideProducts
    ? NAV_ITEMS.filter((item) => item.labelKey !== 'products')
    : NAV_ITEMS;

  return (
    <>
      <nav className="flex-1 overflow-y-auto py-3" aria-label="Main">
        <ul className="flex flex-col gap-1 px-2">
          {navItems.map((item) => (
            <li key={item.labelKey}>
              <SidebarLink
                item={item}
                expanded={expanded}
                active={isItemActive(item, currentPath)}
                label={t(item.labelKey)}
                href={`${localePrefix}${item.href}`}
                onClick={onNavigate}
              />
            </li>
          ))}
        </ul>
      </nav>

      <div className="space-y-2 border-t border-border px-2 py-3">
        {user ? (
          <div
            className={cn(
              'flex items-center gap-2 rounded px-2 py-1.5',
              expanded ? 'bg-bg-surface-2' : '',
            )}
            title={expanded ? undefined : (user.fullName ?? user.email)}
          >
            <Avatar fullName={user.fullName} email={user.email} avatarUrl={user.avatarUrl} />
            {expanded ? (
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-text-primary">
                  {user.fullName ?? user.email}
                </p>
                {user.fullName ? (
                  <p className="truncate text-[10px] text-text-muted">{user.email}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <LocaleSwitcher
          locale={locale}
          currentPath={currentPath}
          expanded={expanded}
          label={t('switchLanguage')}
          onClick={onNavigate}
        />

        <form action={signOutAction}>
          <input type="hidden" name="locale" value={locale} />
          <button
            type="submit"
            className={cn(
              'flex h-10 w-full items-center gap-3 rounded px-2 transition-colors',
              'text-text-secondary hover:bg-bg-surface-2 hover:text-text-primary',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            )}
            title={expanded ? undefined : t('logout')}
            aria-label={t('logout')}
          >
            <span className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center">
              <LogOut className="h-5 w-5" />
            </span>
            {expanded ? <span className="truncate text-sm font-medium">{t('logout')}</span> : null}
          </button>
        </form>
      </div>
    </>
  );
}

/**
 * Sidebar locale toggle. Computes the URL of the current page in the other
 * locale by replacing the leading `/<locale>` segment, preserving the
 * pathname so the user lands on the same screen they were viewing.
 */
function LocaleSwitcher({
  locale,
  currentPath,
  expanded,
  label,
  onClick,
}: {
  locale: string;
  currentPath: string;
  expanded: boolean;
  label: string;
  onClick?: () => void;
}) {
  const other = locale === 'fr' ? 'en' : 'fr';
  // `currentPath` is already locale-stripped. Empty / "/" means root.
  const target = currentPath === '/' ? `/${other}/` : `/${other}${currentPath}`;
  return (
    <Link
      href={target}
      title={expanded ? undefined : label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'flex h-10 w-full items-center gap-3 rounded px-2 transition-colors',
        'text-text-secondary hover:bg-bg-surface-2 hover:text-text-primary',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
      )}
    >
      <span className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center">
        <Globe className="h-5 w-5" />
      </span>
      {expanded ? (
        <span className="truncate text-sm font-medium">
          {locale.toUpperCase()} → {other.toUpperCase()}
        </span>
      ) : null}
    </Link>
  );
}

function SidebarLink({
  item,
  expanded,
  active,
  label,
  href,
  onClick,
}: {
  item: NavItem;
  expanded: boolean;
  active: boolean;
  label: string;
  href: string;
  onClick?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={href}
      title={expanded ? undefined : label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'relative flex h-10 items-center gap-3 rounded px-2 transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        active
          ? 'bg-accent-subtle text-accent'
          : 'text-text-secondary hover:bg-bg-surface-2 hover:text-text-primary',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-accent transition-opacity',
          active ? 'opacity-100' : 'opacity-0',
        )}
      />
      <span className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center">
        <Icon className="h-5 w-5" />
        {item.notif ? (
          <span className="absolute right-0 top-0 h-2 w-2 rounded-full bg-danger ring-2 ring-bg-surface" />
        ) : null}
      </span>
      {expanded ? <span className="truncate text-sm font-medium">{label}</span> : null}
    </Link>
  );
}

function Avatar({
  fullName,
  email,
  avatarUrl,
}: {
  fullName: string | null;
  email: string;
  avatarUrl: string | null;
}) {
  if (avatarUrl) {
    // `next/image` lazy-loads, serves AVIF/WebP, and emits a srcset — wins over
    // a plain <img> tag for the user avatar that appears on every page.
    return (
      <Image
        src={avatarUrl}
        alt=""
        width={28}
        height={28}
        className="h-7 w-7 shrink-0 rounded-full object-cover"
        unoptimized={false}
      />
    );
  }
  const initials =
    (fullName ?? email)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('') || '?';
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-[10px] font-semibold text-accent">
      {initials}
    </span>
  );
}
