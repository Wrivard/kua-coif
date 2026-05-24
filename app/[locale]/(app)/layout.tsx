import type { ReactNode } from 'react';
import { Sidebar } from '@/components/ui/sidebar';
import { FabButtons } from '@/components/ui/fab-buttons';
import { ToastProvider } from '@/components/ui/toast';
import { getCurrentUser } from '@/lib/auth/server';

export default async function AppShellLayout({
  children,
  params: { locale },
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  const user = await getCurrentUser();

  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-bg-base">
        <Sidebar
          locale={locale}
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
  );
}
