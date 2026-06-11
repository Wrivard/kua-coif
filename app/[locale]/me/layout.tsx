import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { ToastProvider } from '@/components/ui/toast';
import { pickMessages } from '@/lib/i18n-pick';

/**
 * Plan 041 (PERF-09) — scoped i18n provider for the me token surface
 * (SMS/email-opened, mobile-first: only its own namespaces ship, not the
 * ~80KB catalog).
 * Also mounts the ToastProvider this segment's client relies on — useToast
 * previously THREW here (no provider anywhere in the token trees).
 */
export default async function MeSegmentLayout(props: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const messages = pickMessages(await getMessages(), ['pages.me', 'a11y']);
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ToastProvider>{props.children}</ToastProvider>
    </NextIntlClientProvider>
  );
}
