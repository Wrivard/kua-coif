import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast';

/**
 * Layout for `/no-shop` — the post-signup landing page when the user has no
 * `shop_members` row yet. Visually mirrors the auth shell (centered card on
 * `bg-base`) without dragging in the auth-only branding text.
 */
export default function NoShopLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <main
        id="main"
        className="flex min-h-screen items-center justify-center bg-bg-base px-4 py-12"
      >
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center justify-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded bg-accent text-accent-fg">
              <span className="text-sm font-bold">K</span>
            </span>
            <span className="text-lg font-semibold text-text-primary">Küa</span>
          </div>
          {children}
        </div>
      </main>
    </ToastProvider>
  );
}
