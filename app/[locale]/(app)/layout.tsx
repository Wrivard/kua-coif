import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { Sidebar } from '@/components/ui/sidebar';
import { MobileSidebar } from '@/components/ui/mobile-sidebar';
import { FabButtons } from '@/components/ui/fab-buttons';
import { ToastProvider } from '@/components/ui/toast';
import { QueryProvider } from '@/components/providers/query-provider';
import { getCurrentShop, getCurrentUser } from '@/lib/auth/server';
import { INDUSTRIES, isIndustryKind } from '@/lib/industries';
import { setUser } from '@/lib/observability';

export default async function AppShellLayout({
  children,
  params: { locale },
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  // Pull user, translations, and the shop row in parallel — they have no
  // ordering dependency on each other. `getCurrentShop` is the single
  // request-cached read of the shops table (id, name, timezone, industry)
  // that downstream pages will re-use without re-querying.
  const [user, tA11y, shop] = await Promise.all([
    getCurrentUser(),
    getTranslations({ locale, namespace: 'a11y' }),
    getCurrentShop(),
  ]);

  // Resolve the shop's industry → drives nav-item visibility (Phase 23).
  // Therapy verticals (massage, physio, chiro) skip the Products tab.
  let hideProducts = false;
  if (shop?.industry && isIndustryKind(shop.industry)) {
    hideProducts = !INDUSTRIES[shop.industry].features.products;
  }

  // Phase 70 audit fix: tag the active Sentry scope with the user so
  // error reports come through correlated to "who was logged in." Safe
  // no-op when no DSN is configured. Server-side scope only — the
  // client scope is set independently in `sentry.client.config.ts` via
  // Sentry's user-tagging API.
  if (user) {
    setUser({ id: user.id, email: user.email });
  }

  return (
    <QueryProvider>
      <ToastProvider>
        {/* Skip link — visible only when focused. Keyboard users hitting
            Tab on page load land here first so they can jump past the
            13+ sidebar items straight into the main content. Required
            for WCAG 2.1 SC 2.4.1 (Bypass Blocks). */}
        <a
          href="#main"
          className="sr-only z-[60] rounded-sm bg-accent px-3 py-2 text-sm font-semibold text-accent-fg shadow-lg focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        >
          {tA11y('skipToContent')}
        </a>
        <div className="flex min-h-screen bg-bg-base">
          {(() => {
            // Resolve the SidebarUser shape once and reuse for both desktop +
            // mobile renderings. Same payload, different containers.
            const sidebarUser = user
              ? {
                  id: user.id,
                  email: user.email ?? '',
                  fullName:
                    (typeof user.user_metadata?.full_name === 'string'
                      ? user.user_metadata.full_name
                      : undefined) ?? null,
                  avatarUrl:
                    (typeof user.user_metadata?.avatar_url === 'string'
                      ? user.user_metadata.avatar_url
                      : undefined) ?? null,
                }
              : null;
            return (
              <>
                <Sidebar locale={locale} hideProducts={hideProducts} user={sidebarUser} />
                <MobileSidebar locale={locale} hideProducts={hideProducts} user={sidebarUser} />
              </>
            );
          })()}
          <main id="main" className="flex min-w-0 flex-1 flex-col">
            {children}
          </main>
          <FabButtons />
        </div>
      </ToastProvider>
    </QueryProvider>
  );
}
