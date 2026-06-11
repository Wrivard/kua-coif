import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { pickMessages } from '@/lib/i18n-pick';

/**
 * Plan 041 (PERF-09) — scoped i18n provider for the receipt token surface
 * (SMS/email-opened, mobile-first: only its own namespaces ship, not the
 * ~80KB catalog).
 */
export default async function ReceiptSegmentLayout(props: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const messages = pickMessages(await getMessages(), ['pages.receipt']);
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {props.children}
    </NextIntlClientProvider>
  );
}
