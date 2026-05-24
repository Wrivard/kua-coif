import '../globals.css';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
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
    <html lang={locale} className="dark">
      <body className="min-h-screen bg-bg-base text-text-primary antialiased">
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
