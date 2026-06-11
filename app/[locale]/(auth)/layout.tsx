import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { ToastProvider } from '@/components/ui/toast';
import { RouteReveal } from '@/components/ui/route-reveal';
import { pickMessages } from '@/lib/i18n-pick';

/**
 * Auth shell — Phase 47 premium polish.
 *
 * Centered card on a near-black canvas with a soft NEUTRAL radial
 * gradient behind it (contract C5 — atmosphere is neutral/warm, never
 * an accent wash). The gradient is rendered via two stacked
 * radial-gradient backgrounds:
 *   1. A wide neutral warm glow via var(--hero-glow) (the "ambient
 *      light source"); the only accent on this screen is the brand mark.
 *   2. A subtle dot grid at ~3% opacity (texture, prevents the bg
 *      from feeling like a flat slab).
 *
 * Both are pure CSS — no images, no JS. Performance cost is negligible
 * because the auth screen is rendered once per session.
 */
export default async function AuthLayout(props: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  const { children } = props;
  setRequestLocale(locale);
  // Plan 041 (PERF-09) — the auth screens' client surface only consumes the
  // auth namespaces (+ a11y for toast chrome); no need to ship the catalog.
  const messages = pickMessages(await getMessages(), ['auth', 'a11y']);
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ToastProvider>
        <main
          id="main"
          className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg-base px-4 py-12"
        >
          {/* Ambient neutral radial — sits behind everything, draws the
            eye to the center card without competing with content. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(ellipse 80% 50% at 50% 35%, var(--hero-glow), transparent 70%)',
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
            <RouteReveal>{children}</RouteReveal>
          </div>
        </main>
      </ToastProvider>
    </NextIntlClientProvider>
  );
}
