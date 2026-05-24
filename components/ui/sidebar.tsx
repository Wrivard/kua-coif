'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ChevronsLeft, ChevronsRight, LogOut } from 'lucide-react';
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
};

export function Sidebar({ locale, user }: Props) {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const [expanded, setExpanded] = useState(false);

  const currentPath = stripLocale(pathname, locales);
  const localePrefix = `/${locale}`;

  return (
    <aside
      className={cn(
        'sticky top-0 flex h-screen shrink-0 flex-col border-r border-border bg-bg-surface transition-[width] duration-200 ease-in-out',
        expanded ? 'w-sidebar-w-open' : 'w-sidebar-w',
      )}
      aria-label="Primary navigation"
    >
      <div className="flex h-header-h items-center justify-between border-b border-border px-3">
        <Link
          href={`${localePrefix}/`}
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
          className="rounded p-1 text-text-muted transition-colors hover:bg-bg-surface-2 hover:text-text-primary"
        >
          {expanded ? <ChevronsLeft className="h-4 w-4" /> : <ChevronsRight className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-3" aria-label="Main">
        <ul className="flex flex-col gap-1 px-2">
          {NAV_ITEMS.map((item) => (
            <li key={item.labelKey}>
              <SidebarLink
                item={item}
                expanded={expanded}
                active={isItemActive(item, currentPath)}
                label={t(item.labelKey)}
                href={`${localePrefix}${item.href}`}
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
    </aside>
  );
}

function SidebarLink({
  item,
  expanded,
  active,
  label,
  href,
}: {
  item: NavItem;
  expanded: boolean;
  active: boolean;
  label: string;
  href: string;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={href}
      title={expanded ? undefined : label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex h-10 items-center gap-3 rounded px-2 transition-colors',
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
    /* eslint-disable-next-line @next/next/no-img-element */
    return <img src={avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />;
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
