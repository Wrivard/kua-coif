import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast';

/**
 * Public booking layout — outside the auth shell, no sidebar.
 *
 * Phase 47b premium polish: same ambient-gradient + dot-grid recipe as the
 * auth shell, but tuned for a longer scrolling page. The radial sits near
 * the top so it draws the eye to the shop name without competing with the
 * sticky subtotal pinned at the bottom of the viewport on mobile.
 *
 * Mobile-first since most clients book from their phone.
 */
export default function BookingLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <main
        id="main"
        className="relative min-h-screen overflow-x-hidden bg-bg-base px-3 py-8 sm:px-6 sm:py-12"
      >
        {/* Ambient purple radial — anchored to the top so it haloes the
            shop name without bleeding into the action area below the fold. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[480px]"
          style={{
            background:
              'radial-gradient(ellipse 70% 60% at 50% 0%, rgba(139, 92, 246, 0.18), transparent 70%)',
          }}
        />
        {/* Dot grid texture — keeps the canvas from feeling like a void on
            screens taller than 720px. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, var(--texture-dot) 1px, transparent 0)',
            backgroundSize: '32px 32px',
          }}
        />
        <div className="relative mx-auto w-full max-w-2xl">{children}</div>
      </main>
    </ToastProvider>
  );
}
