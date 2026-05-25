'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { stripLocale } from '@/lib/nav-items';
import { locales } from '@/i18n';
import { SidebarNavInner, type SidebarUser } from './sidebar';

/**
 * Mobile navigation — Phase 29 round 3.
 *
 * On `< md`, the desktop `<Sidebar>` is hidden via `hidden md:flex`. This
 * component renders:
 *  - A fixed hamburger button in the top-left corner (z-50, above all page
 *    content including the sticky PageHeader).
 *  - A full-screen drawer overlay that slides in from the left with the
 *    same nav content as the desktop sidebar (always "expanded" mode since
 *    the drawer is wide enough for labels).
 *
 * Inlines the Drawer logic (transform/opacity transitions) rather than
 * reusing `<Drawer>` because:
 *   - Drawer width here is fixed at `w-72` (no need for the polymorphic
 *     width prop).
 *   - We want the trigger button + drawer in one place so the layout doesn't
 *     have to thread an open/close prop around.
 *
 * The hamburger has `md:hidden`; the desktop sidebar has `hidden md:flex`.
 * They never both render — there's no z-index battle to worry about.
 */
export function MobileSidebar({
  locale,
  user,
  hideProducts = false,
}: {
  locale: string;
  user: SidebarUser | null;
  hideProducts?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const t = useTranslations('nav');
  const currentPath = stripLocale(pathname, locales);

  // Close the drawer whenever the route changes — useful when the user
  // taps a nav link OR uses the browser back button while the drawer is
  // open. Without this, the drawer would stay rendered over the new page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // ESC closes the drawer for keyboard users. Tied to the open state so
  // the listener is only attached while needed.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Lock body scroll while open — otherwise mobile users can scroll the
  // page underneath the overlay, which feels broken on iOS.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      {/* Hamburger trigger. Fixed top-left of viewport so it's reachable
          regardless of page scroll. Hidden on `>= md` where the desktop
          sidebar takes over. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('openMenu')}
        aria-expanded={open}
        className={cn(
          'fixed left-3 top-3 z-40 flex h-10 w-10 items-center justify-center rounded-md',
          'border border-border bg-bg-surface text-text-primary shadow-sm',
          'transition-colors hover:bg-bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          'md:hidden',
        )}
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Drawer container — covers the whole viewport. `pointer-events-none`
          when closed so the underlying page stays interactive; opacity-0 on
          the backdrop fades it out. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        className={cn(
          'fixed inset-0 z-50 md:hidden',
          open ? 'pointer-events-auto' : 'pointer-events-none',
        )}
      >
        {/* Backdrop */}
        <div
          onClick={() => setOpen(false)}
          className={cn(
            'absolute inset-0 bg-black/60 transition-opacity duration-200 ease-out',
            open ? 'opacity-100' : 'opacity-0',
          )}
          aria-hidden
        />
        {/* Drawer panel — slides in from the left. */}
        <aside
          className={cn(
            'absolute left-0 top-0 flex h-full w-72 max-w-[80vw] flex-col border-r border-border bg-bg-surface text-text-primary shadow-2xl transition-transform duration-200 ease-out',
            open ? 'translate-x-0' : '-translate-x-full',
          )}
          aria-label="Primary navigation"
        >
          {/* Drawer header — Küa brand + close. Mirrors the desktop sidebar's
              expanded header. */}
          <div className="flex h-header-h items-center justify-between border-b border-border px-3">
            <Link
              href={`/${locale}/`}
              className="flex items-center gap-2"
              onClick={() => setOpen(false)}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-accent text-accent-fg">
                <span className="text-sm font-bold">K</span>
              </span>
              <span className="truncate text-sm font-semibold text-text-primary">Küa</span>
            </Link>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('closeMenu')}
              className="rounded p-1 text-text-muted transition-colors hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <SidebarNavInner
            locale={locale}
            user={user}
            currentPath={currentPath}
            expanded={true}
            hideProducts={hideProducts}
            onNavigate={() => setOpen(false)}
          />
        </aside>
      </div>
    </>
  );
}
