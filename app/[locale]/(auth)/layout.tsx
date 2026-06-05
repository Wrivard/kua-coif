import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast';

/**
 * Auth shell — Phase 47 premium polish.
 *
 * Centered card on a near-black canvas with a soft accent radial
 * gradient behind it. The gradient is rendered via two stacked
 * radial-gradient backgrounds:
 *   1. A wide purple glow ~30% opacity (the "ambient light source").
 *   2. A subtle dot grid at ~3% opacity (texture, prevents the bg
 *      from feeling like a flat slab).
 *
 * Both are pure CSS — no images, no JS. Performance cost is negligible
 * because the auth screen is rendered once per session.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <main
        id="main"
        className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg-base px-4 py-12"
      >
        {/* Ambient purple radial — sits behind everything, draws the
            eye to the center card without competing with content. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 80% 50% at 50% 35%, rgba(139, 92, 246, 0.18), transparent 70%)',
          }}
        />
        {/* Subtle dot grid texture so the dark canvas reads as
            "intentional surface" not "missing image." */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, var(--texture-dot) 1px, transparent 0)',
            backgroundSize: '32px 32px',
          }}
        />

        <div className="relative w-full max-w-md">
          {/* Brand mark — larger and more centered than V1. The
              accent-glow shadow gives the K a soft purple halo that
              echoes the ambient background. */}
          <div className="mb-8 flex flex-col items-center gap-3">
            <span className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-accent-glow">
              <span className="text-lg font-semibold">K</span>
            </span>
            <span className="text-sm font-medium tracking-wide text-text-secondary">Küa</span>
          </div>
          {children}
        </div>
      </main>
    </ToastProvider>
  );
}
