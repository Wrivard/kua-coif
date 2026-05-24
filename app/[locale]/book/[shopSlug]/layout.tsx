import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast';

/**
 * Public booking layout — outside the auth shell, no sidebar.
 * Mobile-first since most clients book from their phone.
 */
export default function BookingLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <main id="main" className="min-h-screen bg-bg-base px-3 py-6 sm:px-6">
        <div className="mx-auto w-full max-w-2xl">{children}</div>
      </main>
    </ToastProvider>
  );
}
