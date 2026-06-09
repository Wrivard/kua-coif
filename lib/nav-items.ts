import {
  BookOpen,
  Calendar,
  DollarSign,
  LifeBuoy,
  Megaphone,
  Package,
  Scissors,
  Settings,
  UserCircle2,
  Users,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

export type NavItem = {
  /** Path WITHOUT locale prefix. "/" matches the app root. */
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Key under `nav.*` in messages JSON. */
  labelKey:
    | 'appointments'
    | 'clients'
    | 'services'
    | 'barbers'
    | 'products'
    | 'support'
    | 'documentation'
    | 'settings'
    | 'marketing'
    | 'finances'
    | 'logout';
  /**
   * Pathname (without locale) that marks this item as "active" when the current
   * pathname matches OR is nested under it. Defaults to `href` when omitted.
   * Use this when `href` is a deep link inside a section (e.g. Settings → Shop).
   */
  matchPath?: string;
  /** Treat as active for any nested route under `matchPath` (default true except for "/"). */
  matchPrefix?: boolean;
  /** Optional notification badge (e.g. unread). */
  notif?: boolean;
};

export const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: '/', icon: Calendar, labelKey: 'appointments' },
  { href: '/clients', icon: Users, labelKey: 'clients', matchPrefix: true },
  { href: '/services', icon: Scissors, labelKey: 'services', matchPrefix: true },
  { href: '/barbers', icon: UserCircle2, labelKey: 'barbers', matchPrefix: true },
  { href: '/products', icon: Package, labelKey: 'products', matchPrefix: true },
  { href: '/support', icon: LifeBuoy, labelKey: 'support', matchPrefix: true },
  { href: '/documentation', icon: BookOpen, labelKey: 'documentation', matchPrefix: true },
  {
    href: '/settings/shop',
    matchPath: '/settings',
    icon: Settings,
    labelKey: 'settings',
    matchPrefix: true,
  },
  { href: '/marketing', icon: Megaphone, labelKey: 'marketing', matchPrefix: true },
  { href: '/finances', icon: DollarSign, labelKey: 'finances', matchPrefix: true, notif: true },
];

/**
 * Strip the locale segment (`/fr/...` → `/...`) for comparison against `href` / `matchPath`.
 */
export function stripLocale(pathname: string, locales: ReadonlyArray<string>) {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return '/';
  if (locales.includes(segments[0]!)) {
    const rest = segments.slice(1).join('/');
    return rest ? `/${rest}` : '/';
  }
  return pathname || '/';
}

export function isItemActive(item: NavItem, currentPath: string) {
  const target = item.matchPath ?? item.href;
  if (target === '/') return currentPath === '/';
  if (item.matchPrefix) return currentPath === target || currentPath.startsWith(`${target}/`);
  return currentPath === target;
}
