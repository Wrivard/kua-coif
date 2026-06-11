import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { ToastProvider } from '@/components/ui/toast';
import { pickMessages } from '@/lib/i18n-pick';

/**
 * Embed layout — the chrome for `/embed/[shopSlug]`.
 *
 * Key differences with `/book/[shopSlug]`:
 *   - No global `<main>` skip-link / no `min-h-screen` / no horizontal padding.
 *     The widget is iframed at the size the parent picks; we let content flow
 *     and the page emits its height via `postMessage` so the parent resizes.
 *   - No max-width container — the parent iframe controls width.
 *   - Background is transparent-ish so a parent with a non-dark theme still
 *     blends; the wizard card has its own surface color so it stands out.
 */
export default async function EmbedLayout(props: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  const { children } = props;
  setRequestLocale(locale);
  // Plan 041 (PERF-09) — the iframe ships the wizard + the embed error/empty
  // namespaces (+ a11y for toast chrome), not the whole catalog. Every byte
  // here loads on third-party sites at THEIR traffic.
  const messages = pickMessages(await getMessages(), [
    'pages.booking',
    'pages.embed',
    'actionErrors',
    'a11y',
  ]);
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ToastProvider>
        <div className="widget-root bg-bg-base px-3 py-4 sm:px-5">{children}</div>
      </ToastProvider>
    </NextIntlClientProvider>
  );
}
