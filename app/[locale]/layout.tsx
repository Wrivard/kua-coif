import '../globals.css';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { CookieBanner } from '@/components/ui/cookie-banner';
import { locales, type Locale } from '@/i18n';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import { pickMessages } from '@/lib/i18n-pick';

export const metadata: Metadata = {
  title: 'Küa — Salon Management',
  description: 'Plateforme de gestion pour salons et barbershops.',
};

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout(props: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const params = await props.params;

  const { locale } = params;

  const { children } = props;

  if (!locales.includes(locale as Locale)) notFound();

  setRequestLocale(locale);
  // Plan 041 (PERF-09) — the ROOT provider carries only what root-level
  // client components need (the cookie banner). Each route group nests its
  // own provider: the admin (app) shell re-provides the FULL catalog; the
  // public layouts (book, embed, token segments, auth, no-shop) provide a
  // per-surface pick — so ~80KB/locale of admin strings no longer embed in
  // every booking/token page load. Server components are unaffected
  // (getTranslations/useTranslations resolve server-side).
  const messages = pickMessages(await getMessages(), ['legal.cookieBanner']);

  return (
    // Loop 37 (P114) — Geist Sans + Mono loaded via next/font so the
    // font files actually ship (the previous `font-family: 'Geist'`
    // in globals.css was a string with no font-face — most users
    // were seeing the fallback ui-sans-serif). The two CSS variables
    // (`--font-geist-sans`, `--font-geist-mono`) are referenced by
    // tailwind's `font-sans` and `font-mono` utilities.
    //
    // Loop 60 — `dark` class no longer hardcoded. The inline script
    // below (in <head>) runs synchronously before paint and sets the
    // `data-theme` attribute based on localStorage + prefers-color-
    // scheme. No FOUC on either theme.
    <html lang={locale} className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        {/* Loop 60 — FOUC-safe theme init. Must execute synchronously
         *  in <head> BEFORE the body renders, otherwise the first paint
         *  flashes the wrong theme. The script is hand-inlined (vs a
         *  React component) so React's hydration isn't a prerequisite.
         *  Source of truth: `lib/theme.ts`. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-bg-base font-sans text-text-primary antialiased">
        {/* Skip-to-content link — visible only when focused with Tab. */}
        <a
          href="#main"
          className="sr-only fixed left-2 top-2 z-50 rounded bg-accent px-3 py-2 text-sm font-medium text-accent-fg focus:not-sr-only focus:outline-none"
        >
          {locale === 'fr' ? 'Aller au contenu' : 'Skip to content'}
        </a>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
          {/* Loop 48 (P118) — universal cookie banner. Mounted at the
              root so it covers public (booking, legal, login) AND
              authenticated shells. The component reads the consent
              cookie on mount; once set, it renders nothing on every
              subsequent page. */}
          <CookieBanner locale={locale} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
