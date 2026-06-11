import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { ToastProvider } from '@/components/ui/toast';
import { pickMessages } from '@/lib/i18n-pick';

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
export default async function BookingLayout(props: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  const { children } = props;
  setRequestLocale(locale);
  // Plan 041 (PERF-09) — the booking wizard's client surface consumes the
  // booking namespaces + action errors (+ a11y for toast/dialog chrome);
  // the rest of the ~80KB catalog no longer embeds in every booking load.
  const messages = pickMessages(await getMessages(), ['pages.booking', 'actionErrors', 'a11y']);
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ToastProvider>
        <main
          id="main"
          className="relative min-h-screen overflow-x-hidden bg-bg-base px-3 py-8 sm:px-6 sm:py-12"
        >
          {/* Ambient neutral radial — anchored to the top so it haloes the
            shop name without bleeding into the action area below the fold.
            Neutral (var(--hero-glow)) per contract C5: atmosphere is never
            an accent wash; the brand mark is the only accent up here. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[480px]"
            style={{
              background:
                'radial-gradient(ellipse 70% 60% at 50% 0%, var(--hero-glow), transparent 70%)',
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
    </NextIntlClientProvider>
  );
}
