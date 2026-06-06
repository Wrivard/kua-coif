'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import {
  Check,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Globe,
  LogOut,
  ShieldCheck,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { isItemActive, NAV_ITEMS, stripLocale, type NavItem } from '@/lib/nav-items';
import { locales } from '@/i18n';
import { signOutAction } from '@/lib/auth/actions';
import { selectShop } from '@/app/[locale]/(app)/actions-shop-switcher';
import { ThemeToggle } from '@/components/ui/theme-toggle';

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
  /**
   * Loop 39 (P119) — active shop label rendered in the sidebar header.
   * `null` falls back to the legacy "Küa" wordmark.
   */
  activeShopId?: string | null;
  activeShopName?: string | null;
  /**
   * The user's confirmed shop memberships with display names. Empty
   * when the user has a single shop (no switcher rendered then).
   */
  shopRows?: Array<{ shop_id: string; name: string }>;
  /**
   * Phase H+4 — when true, the sidebar renders an extra "Küa admin"
   * item at the bottom of the nav that links to /[locale]/super-admin.
   * Read from `profiles.is_kua_admin` server-side; never inferred from
   * the client. False for everyone else (the item simply doesn't render).
   */
  isKuaAdmin?: boolean;
};

/**
 * Desktop sidebar — `hidden md:flex` so it's only visible on `>= md` screens.
 * On smaller viewports, `<MobileSidebar>` (separate file) provides the same
 * navigation behind a hamburger trigger. Both share `<SidebarNavInner>` so
 * the nav item rendering, locale switcher, and logout button stay consistent.
 */
export function Sidebar({
  locale,
  user,
  hideProducts = false,
  activeShopId = null,
  activeShopName = null,
  shopRows = [],
  isKuaAdmin = false,
}: Props) {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const [expanded, setExpanded] = useState(true);

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
      <div className="flex h-header-h flex-col justify-center border-b border-border-soft px-3">
        {expanded ? (
          // Expanded: logo wordmark on top, active-shop name underneath,
          // collapse chevron parked top-right of the logo row.
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Link href={`/${locale}/`} aria-label="Küa" className="flex shrink-0 items-center">
                <Image
                  src="/logo.png"
                  alt="Küa"
                  width={84}
                  height={28}
                  priority
                  className="brand-logo h-7 w-auto"
                />
              </Link>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-label={t('collapseSidebar')}
                className="shrink-0 rounded p-1 text-text-muted transition-colors hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>
            </div>
            <ShopSwitcher
              activeShopId={activeShopId}
              activeShopName={activeShopName}
              shopRows={shopRows}
              className="w-full"
            />
          </div>
        ) : (
          // Collapsed: icon mark stacked over the expand chevron.
          <div className="flex flex-col items-center gap-1.5">
            <Link href={`/${locale}/`} aria-label="Küa" className="flex shrink-0 items-center">
              <Image
                src="/logo-icon.png"
                alt="Küa"
                width={32}
                height={32}
                priority
                className="brand-logo h-8 w-8 object-contain"
              />
            </Link>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-label={t('expandSidebar')}
              className="rounded p-1 text-text-muted transition-colors hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <SidebarNavInner
        locale={locale}
        user={user}
        currentPath={currentPath}
        expanded={expanded}
        hideProducts={hideProducts}
        isKuaAdmin={isKuaAdmin}
      />
    </aside>
  );
}

/**
 * Loop 39 (P119) — sidebar header dropdown that shows the active shop
 * name and lets multi-shop users switch in-place. Single-shop users
 * (empty `shopRows`) see a static label only — no chevron, no menu.
 *
 * The dropdown closes on outside click, Escape, or selection. The
 * underlying server action `selectShop` writes the
 * `kua_active_shop` cookie and `router.refresh()` re-renders the
 * shell with the new shop's data.
 */
export function ShopSwitcher({
  activeShopId,
  activeShopName,
  shopRows,
  className,
}: {
  activeShopId: string | null;
  activeShopName: string | null;
  shopRows: Array<{ shop_id: string; name: string }>;
  /** Layout classes from the caller (desktop stacks it full-width; mobile
   *  lays it out in a row). Keeps the switcher layout-agnostic. */
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const hasMultiple = shopRows.length > 1;

  // Close on outside click / Escape — manual instead of pulling in a
  // popover lib for one use site.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function onPick(shopId: string) {
    if (shopId === activeShopId) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const result = await selectShop({ shop_id: shopId });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        // Soft-fail: keep dropdown open so user can retry. A toast
        // would be nicer but the Sidebar mounts outside ToastProvider
        // on some layouts — defer to a follow-up if real failures
        // start showing up in Sentry.
        setOpen(false);
      }
    });
  }

  if (!hasMultiple) {
    return (
      <span
        className={cn('truncate text-sm font-semibold text-text-primary', className)}
        title={activeShopName ?? undefined}
      >
        {activeShopName ?? 'Küa'}
      </span>
    );
  }

  return (
    <div ref={wrapperRef} className={cn('relative min-w-0', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-sm font-semibold text-text-primary',
          'transition-colors hover:bg-bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus',
        )}
        disabled={isPending}
      >
        <span className="min-w-0 flex-1 truncate" title={activeShopName ?? undefined}>
          {activeShopName ?? 'Küa'}
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-text-muted transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>
      {open ? (
        // Loop 39 self-review — z-50 so the dropdown sits above
        // sticky page headers, the FAB (z-40), and toasts on dismiss.
        // Below the MobileSidebar overlay (also z-50) the dropdown
        // already mounts INSIDE the drawer so it inherits its
        // stacking context — no z-conflict between the two.
        <ul
          role="listbox"
          className="absolute left-0 top-full z-50 mt-1 max-h-72 w-56 overflow-y-auto rounded-lg bg-bg-elevated p-1 shadow-lg"
        >
          {shopRows.map((row) => {
            const isActive = row.shop_id === activeShopId;
            return (
              <li key={row.shop_id} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  onClick={() => onPick(row.shop_id)}
                  disabled={isPending}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors',
                    isActive
                      ? 'bg-bg-surface-2 text-text-primary'
                      : 'text-text-secondary hover:bg-bg-surface-2 hover:text-text-primary',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                  {isActive ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
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
  isKuaAdmin = false,
  onNavigate,
}: {
  locale: string;
  user: SidebarUser | null;
  currentPath: string;
  expanded: boolean;
  hideProducts?: boolean;
  isKuaAdmin?: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations('nav');
  const localePrefix = `/${locale}`;
  const navItems = hideProducts
    ? NAV_ITEMS.filter((item) => item.labelKey !== 'products')
    : NAV_ITEMS;

  return (
    <>
      <nav className="flex-1 overflow-y-auto py-4" aria-label="Main">
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
          {/* Phase H+4 — Küa-team super-admin link, server-gated on
              `profiles.is_kua_admin`. Renders nothing for everyone else
              so the shop owners + barbers never see it. Active when the
              current path is under /super-admin. */}
          {isKuaAdmin ? (
            <li className="mt-2 border-t border-border pt-2">
              <KuaAdminLink
                href={`${localePrefix}/super-admin`}
                active={currentPath.startsWith('/super-admin')}
                expanded={expanded}
                onClick={onNavigate}
              />
            </li>
          ) : null}
        </ul>
      </nav>

      <div className="space-y-2 border-t border-border-soft px-2 py-3">
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

        {/* Loop 60 — dark/light theme toggle sits between the locale
         *  switcher and the sign-out button so the three "global
         *  controls" rows cluster visually at the foot of the rail. */}
        <ThemeToggle expanded={expanded} onClick={onNavigate} />

        <form action={signOutAction}>
          <input type="hidden" name="locale" value={locale} />
          <button
            type="submit"
            className={cn(
              'flex h-10 w-full items-center gap-3 rounded px-2 transition-colors',
              'text-text-secondary hover:bg-bg-surface-2 hover:text-text-primary',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-focus',
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
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-focus',
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

function KuaAdminLink({
  href,
  active,
  expanded,
  onClick,
}: {
  href: string;
  active: boolean;
  expanded: boolean;
  onClick?: () => void;
}) {
  const label = 'Küa admin';
  return (
    <Link
      href={href}
      title={expanded ? undefined : label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'relative flex h-10 items-center gap-3 rounded-lg px-2 transition-colors duration-150 ease-out-quint',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-focus',
        active
          ? // Mirrors SidebarLink (refonte): elevated pill plus accent location bar.
            'bg-bg-surface-2 text-text-primary shadow-sm'
          : 'text-text-secondary hover:bg-bg-surface-2 hover:text-text-primary',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r bg-accent transition-opacity duration-150',
          active ? 'opacity-100' : 'opacity-0',
        )}
      />
      <span className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center">
        <ShieldCheck className="h-5 w-5" />
      </span>
      {expanded ? <span className="truncate text-sm font-medium">{label}</span> : null}
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
        'relative flex h-10 items-center gap-3 rounded-lg px-2 transition-colors duration-150 ease-out-quint',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-focus',
        active
          ? // Refonte (Vercel-grade): active = an elevated pill (surface-2 plus
            // shadow-sm depth) with high-contrast primary text, marked by a
            // crisp accent left bar. The accent here is the "you are here" live
            // location signal (the carve-out the accent discipline allows) and
            // gives the otherwise-monochrome rail a confident brand beat.
            'bg-bg-surface-2 text-text-primary shadow-sm'
          : 'text-text-secondary hover:bg-bg-surface-2 hover:text-text-primary',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r bg-accent transition-opacity duration-150',
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
