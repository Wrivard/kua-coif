import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { PreviewWrapper } from '../preview-wrapper';
import { WidgetResizeEmitter } from '../widget-resize-emitter';
import { loadEmbedData } from '../load-embed-data';

// Plan 038 (PERF-01) — the admin live-preview pane gets its own ALWAYS-FRESH
// route so the public `embed/[shopSlug]` page can be ISR-cached. Only the
// /settings/widget iframe loads this (same-origin); it re-mounts on every
// saved-config version bump (`?v=`) and must reflect the just-saved config
// immediately, so request-time rendering is the point, not a leak.
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string; shopSlug: string }>;
};

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function EmbedPreviewPage(props: Props) {
  const params = await props.params;

  const { locale, shopSlug } = params;

  setRequestLocale(locale);

  const data = await loadEmbedData(locale, shopSlug);
  if (!data) notFound();
  const { shopRow, widgetConfig, hours, daysOff, barbers, services, categories, tipsConfig } = data;

  // Theme bootstrap from the SAVED mode (pre-hydration, no flash). The live
  // preview listener inside PreviewWrapper re-themes reactively afterwards;
  // it also owns ALL theme CSS (no static themeCss block here — emitting
  // both meant clearing an override couldn't visually reset).
  const themeOverrideScript =
    widgetConfig.mode === 'auto'
      ? null
      : `(function(){var t='${widgetConfig.mode}';document.documentElement.setAttribute('data-theme',t);document.documentElement.classList.toggle('dark',t==='dark');})();`;

  return (
    <>
      {themeOverrideScript ? (
        // eslint-disable-next-line react/no-danger
        <script dangerouslySetInnerHTML={{ __html: themeOverrideScript }} />
      ) : null}
      <WidgetResizeEmitter />
      <PreviewWrapper
        initialConfig={widgetConfig}
        rawShop={shopRow}
        locale={locale}
        shopSlug={shopSlug}
        hours={hours}
        daysOff={daysOff}
        barbers={barbers}
        services={services}
        categories={categories}
        tipsConfig={tipsConfig}
      />
    </>
  );
}
