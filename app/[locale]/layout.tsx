import '../globals.css';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { locales, type Locale } from '@/i18n';

export const metadata: Metadata = {
  title: 'Küa — Salon Management',
  description: 'Plateforme de gestion pour salons et barbershops.',
};

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params: { locale },
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  if (!locales.includes(locale as Locale)) notFound();

  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    // Loop 37 (P114) — Geist Sans + Mono loaded via next/font so the
    // font files actually ship (the previous `font-family: 'Geist'`
    // in globals.css was a string with no font-face — most users
    // were seeing the fallback ui-sans-serif). The two CSS variables
    // (`--font-geist-sans`, `--font-geist-mono`) are referenced by
    // tailwind's `font-sans` and `font-mono` utilities.
    <html lang={locale} className={`${GeistSans.variable} ${GeistMono.variable} dark`}>
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
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
