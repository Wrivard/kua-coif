import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast';

export default function AuthLayout({ children }: { children: ReactNode }) {
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
