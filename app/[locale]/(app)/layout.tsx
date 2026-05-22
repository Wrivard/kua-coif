import type { ReactNode } from 'react';
import { Sidebar } from '@/components/ui/sidebar';
import { FabButtons } from '@/components/ui/fab-buttons';
import { ToastProvider } from '@/components/ui/toast';

export default function AppShellLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-bg-base">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        <FabButtons />
      </div>
    </ToastProvider>
  );
}
