import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck, Settings as SettingsIcon, Store } from 'lucide-react';
import '../globals.css';
import { ToastProvider } from '@/components/ui/toast';
import { signOutAction } from '@/lib/auth/actions';
import { requireKuaAdmin } from '@/lib/auth/server';
import { defaultLocale } from '@/i18n';

/**
 * Layout for `/admin/*` — the Küa-team super-admin surface.
 *
 * Deliberately **not** under `app/[locale]/` because:
 *   - This UI is for our team, not end-customers. No need to bilingue.
 *   - Putting it outside the locale-prefixed routing keeps it from showing
 *     up in our public sitemap / robots-allowed paths.
 *   - The standard `(app)` shell requires a shop membership; super-admins
 *     don't always have one, so they need their own chrome.
 *
 * Style-wise we keep the dark theme + accent so the shift between admin and
 * the shop dashboard is visually consistent.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Phase F SR — defense in depth. Every concrete page under /admin/*
  // already calls `requireKuaAdmin()`, but a typo'd path like
  // `/admin/foo` would render Next's 404 INSIDE this admin shell, briefly
  // leaking the "Küa admin · Super-admin console" header to a logged-in
  // non-admin. Gating at the layout level closes that window — non-admins
  // get bounced to /no-shop before any chrome renders.
  await requireKuaAdmin();
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bg-base text-text-primary antialiased">
        <ToastProvider>
          <header className="flex h-header-h items-center justify-between border-b border-border bg-bg-surface px-6">
            <div className="flex items-center gap-3">
              <Link
                href="/admin/shops"
                aria-label="Küa admin home"
                className="flex h-8 w-8 items-center justify-center rounded bg-accent text-accent-fg"
              >
                <ShieldCheck className="h-4 w-4" />
              </Link>
              <div>
                <p className="text-sm font-semibold">Küa admin</p>
                <p className="text-[10px] uppercase tracking-wide text-text-muted">
                  Super-admin console
                </p>
              </div>
              {/* Phase F — nav between the admin sections. Kept minimal
                  (text links, no fancy active state) so we don't have
                  to thread `usePathname` into a server-rendered layout.
                  Future sections (feature flags, support tickets) go
                  here as siblings. */}
              <nav className="ml-6 flex items-center gap-4 text-xs text-text-secondary">
                <Link
                  href="/admin/shops"
                  className="inline-flex items-center gap-1 hover:text-text-primary"
                >
                  <Store className="h-3 w-3" /> Shops
                </Link>
                <Link
                  href="/admin/platform-config"
                  className="inline-flex items-center gap-1 hover:text-text-primary"
                >
                  <SettingsIcon className="h-3 w-3" /> Platform config
                </Link>
              </nav>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href={`/${defaultLocale}/`}
                className="inline-flex items-center gap-1.5 rounded border border-border bg-bg-surface-2 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary"
              >
                <ArrowLeft className="h-3 w-3" /> Exit admin
              </Link>
              <form action={signOutAction}>
                <input type="hidden" name="locale" value={defaultLocale} />
                <button
                  type="submit"
                  className="rounded border border-border bg-bg-surface-2 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary"
                >
                  Sign out
                </button>
              </form>
            </div>
          </header>
          <main className="mx-auto w-full max-w-5xl p-6">{children}</main>
        </ToastProvider>
      </body>
    </html>
  );
}
