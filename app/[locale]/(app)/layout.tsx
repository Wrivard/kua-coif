import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { Sidebar } from '@/components/ui/sidebar';
import { MobileSidebar } from '@/components/ui/mobile-sidebar';
import { FabButtons } from '@/components/ui/fab-buttons';
import { RouteReveal } from '@/components/ui/route-reveal';
import { ToastProvider } from '@/components/ui/toast';
import {
  getCurrentShop,
  getCurrentShopId,
  getCurrentUser,
  getIsKuaAdmin,
  getShopMemberships,
} from '@/lib/auth/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { INDUSTRIES, isIndustryKind } from '@/lib/industries';
import { setUser } from '@/lib/observability';
import { SentryUserInit } from '@/components/features/shell/sentry-user-init';

export default async function AppShellLayout(props: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const params = await props.params;

  const { locale } = params;

  const { children } = props;

  // Pull user, translations, and the shop row in parallel — they have no
  // ordering dependency on each other. `getCurrentShop` is the single
  // request-cached read of the shops table (id, name, timezone, industry)
  // that downstream pages will re-use without re-querying.
  const [user, tA11y, shop, memberships, activeShopId, isKuaAdmin] = await Promise.all([
    getCurrentUser(),
    getTranslations({ locale, namespace: 'a11y' }),
    getCurrentShop(),
    getShopMemberships(),
    getCurrentShopId(),
    // Phase H+4 — drives the "Küa admin" sidebar item visibility.
    getIsKuaAdmin(),
  ]);

  // Resolve the shop's industry → drives nav-item visibility (Phase 23).
  // Therapy verticals (massage, physio, chiro) skip the Products tab.
  let hideProducts = false;
  if (shop?.industry && isIndustryKind(shop.industry)) {
    hideProducts = !INDUSTRIES[shop.industry].features.products;
  }

  // Loop 39 (P119) — resolve the user's membership shop names so the
  // sidebar header can show an active-shop label + a dropdown to
  // switch when the user is a member of >1 shop. We do this in the
  // layout (not in a client component) so the names land in the
  // server payload with the rest of the shell — no extra round-trip.
  // Single-membership users get an empty `shopRows` (rendered as a
  // static label, no dropdown affordance).
  let shopRows: Array<{ shop_id: string; name: string }> = [];
  if (memberships.length > 1) {
    const admin = createSupabaseServiceRoleClient();
    const namesRes = await admin
      .from('shops')
      .select('id, name')
      .in(
        'id',
        memberships.map((m) => m.shop_id),
      );
    const names = new Map<string, string>((namesRes.data ?? []).map((s) => [s.id, s.name]));
    shopRows = memberships.map((m) => ({
      shop_id: m.shop_id,
      name: names.get(m.shop_id) ?? '?',
    }));
  }

  // Phase 70 audit fix: tag the active Sentry scope with the user so
  // error reports come through correlated to "who was logged in." Safe
  // no-op when no DSN is configured. Server-side scope only — the
  // client scope is set independently in `sentry.client.config.ts` via
  // Sentry's user-tagging API.
  if (user) {
    setUser({ id: user.id, email: user.email });
  }

  // Plan 041 (PERF-09) — the ROOT layout now provides only the cookie-banner
  // namespace; the admin shell re-provides the FULL catalog (its client
  // surface spans nearly every namespace, and admins are a logged-in
  // minority — payload size matters less than coverage here).
  const messages = await getMessages();

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ToastProvider>
        {/* Phase 70 audit fix (Loop 18) — tag the Sentry client scope
            with the user. Renders nothing; runs Sentry.setUser in a
            useEffect. Server-scope is set above via setUser(...). */}
        <SentryUserInit id={user?.id ?? null} email={user?.email ?? null} />
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
            // Loop 39 — the sidebar header now shows the active shop
            // name. We always pass the active shop's name (even for
            // single-shop users) so the header reads as "<Shop>" instead
            // of generic "Küa". `shopRows` is empty for single-shop
            // users → no dropdown affordance.
            const activeShopName = shop?.name ?? null;
            return (
              <>
                <Sidebar
                  locale={locale}
                  hideProducts={hideProducts}
                  user={sidebarUser}
                  activeShopId={activeShopId}
                  activeShopName={activeShopName}
                  shopRows={shopRows}
                  isKuaAdmin={isKuaAdmin}
                />
                <MobileSidebar
                  locale={locale}
                  hideProducts={hideProducts}
                  user={sidebarUser}
                  activeShopId={activeShopId}
                  activeShopName={activeShopName}
                  shopRows={shopRows}
                  isKuaAdmin={isKuaAdmin}
                />
              </>
            );
          })()}
          <main id="main" className="flex min-w-0 flex-1 flex-col">
            <RouteReveal>{children}</RouteReveal>
          </main>
          <FabButtons />
        </div>
      </ToastProvider>
    </NextIntlClientProvider>
  );
}
