import type { ReactNode } from 'react';
import { Sidebar } from '@/components/ui/sidebar';
import { FabButtons } from '@/components/ui/fab-buttons';
import { ToastProvider } from '@/components/ui/toast';
import { QueryProvider } from '@/components/providers/query-provider';
import { getCurrentShopId, getCurrentUser } from '@/lib/auth/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { INDUSTRIES, isIndustryKind } from '@/lib/industries';

export default async function AppShellLayout({
  children,
  params: { locale },
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  const user = await getCurrentUser();

  // Resolve the shop's industry → drives nav-item visibility (Phase 23).
  // Therapy verticals (massage, physio, chiro) skip the Products tab. RLS
  // restricts the read to shops the user is a member of.
  let hideProducts = false;
  const shopId = await getCurrentShopId();
  if (shopId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createSupabaseServerClient() as any;
    const res = await sb.from('shops').select('industry').eq('id', shopId).single();
    const industry = (res.data as { industry?: string } | null)?.industry;
    if (industry && isIndustryKind(industry)) {
      hideProducts = !INDUSTRIES[industry].features.products;
    }
  }

  return (
    <QueryProvider>
      <ToastProvider>
        <div className="flex min-h-screen bg-bg-base">
          <Sidebar
            locale={locale}
            hideProducts={hideProducts}
            user={
              user
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
                : null
            }
          />
          <main id="main" className="flex min-w-0 flex-1 flex-col">
            {children}
          </main>
          <FabButtons />
        </div>
      </ToastProvider>
    </QueryProvider>
  );
}
