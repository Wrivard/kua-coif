import { setRequestLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { CalendarX2 } from 'lucide-react';
import { widgetThemeCss } from '@/lib/business/widget-config';
import { WidgetResizeEmitter } from './widget-resize-emitter';
import { EmbedWizard } from './embed-wizard';
import { loadEmbedData } from './load-embed-data';

// Embed widget — same caching strategy as `/book/[shopSlug]` (60s ISR). The
// widget is loaded inside an iframe on third-party sites, so we want it to
// respond fast and not hammer Supabase on every page load.
//
// Plan 038 (PERF-01) — the page no longer reads `searchParams` (that opted
// the route into request-time rendering, so every iframe impression was a
// full SSR + ~7 Supabase queries). The per-instance bits moved client-side:
//   - `?theme=` → resolved by the inline pre-hydration script below.
//   - `?source=` → resolved by the `EmbedWizard` client wrapper.
//   - `?preview=1` → its own always-dynamic route at `embed/[shopSlug]/preview`.
// `generateStaticParams` returning [] opts the route into the SSG/ISR
// machinery with every (locale, slug) rendered on first demand, then cached.
export const revalidate = 60;

export function generateStaticParams(): Array<{ shopSlug: string }> {
  return [];
}

type Props = {
  params: Promise<{ locale: string; shopSlug: string }>;
};

export const metadata: Metadata = {
  // Robots: don't index the embed page directly (it's meant to live inside
  // an iframe on the salon's site, which gets indexed separately).
  robots: { index: false, follow: false },
};

/**
 * Embeddable booking widget — same wizard as `/book/[shopSlug]` but rendered
 * without the app chrome and with per-shop theming applied via CSS vars.
 *
 * Wraps the existing `BookingWizard` so UX improvements land in both surfaces
 * automatically. Loaded inside an iframe injected by `public/widget.js` (or,
 * for the admin live-preview pane, via the sibling `preview/` route).
 */
export default async function EmbedBookingPage(props: Props) {
  const params = await props.params;

  const { locale, shopSlug } = params;

  setRequestLocale(locale);

  const data = await loadEmbedData(locale, shopSlug);
  if (!data) notFound();
  const { widgetConfig, shop, hours, daysOff, barbers, services, categories, tipsConfig } = data;

  const themeCss = widgetThemeCss(widgetConfig);

  // Loop 65 — widget theme override, reworked for ISR (plan 038).
  //
  // The shop's saved `widget_config.mode` is baked into this cached HTML;
  // the per-instance `?theme=dark|light|auto` override is read from
  // `location.search` AT RUNTIME by this same inline script, so one cached
  // document serves every instance without a flash of the wrong theme. The
  // script runs AFTER the root layout's FOUC init script (later in the
  // document) and BEFORE React hydrates. For a resolved mode of 'auto' we
  // intentionally do nothing — the root script's prefers-color-scheme
  // detection is the right behavior.
  const themeOverrideScript = `(function(){var t='${widgetConfig.mode}';var m=/[?&]theme=(dark|light|auto)(&|$)/.exec(location.search);if(m)t=m[1];if(t==='auto')return;document.documentElement.setAttribute('data-theme',t);document.documentElement.classList.toggle('dark',t==='dark');})();`;

  // UX-07 (plan 038) — a shop with nothing bookable used to render the full
  // wizard shell with an empty service list inside the salon's own website.
  // Show a compact, branded "call us" card instead. Done HERE (the embed
  // wrapper), not in the shared BookingWizard.
  const isEmpty = services.length === 0 || barbers.length === 0;
  const tEmbed = isEmpty ? await getTranslations({ locale, namespace: 'pages.embed' }) : null;

  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <script dangerouslySetInnerHTML={{ __html: themeOverrideScript }} />
      {themeCss ? (
        // eslint-disable-next-line react/no-danger
        <style dangerouslySetInnerHTML={{ __html: themeCss }} />
      ) : null}
      <WidgetResizeEmitter />
      {isEmpty && tEmbed ? (
        <div className="flex min-h-[320px] items-center justify-center p-6">
          <div className="flex max-w-sm flex-col items-center gap-3 rounded-lg bg-bg-surface px-6 py-10 text-center shadow-sm">
            <CalendarX2 className="h-8 w-8 text-text-muted" aria-hidden />
            <h1 className="text-base font-semibold text-text-primary">{tEmbed('empty.title')}</h1>
            <p className="text-sm text-text-secondary">{tEmbed('empty.body')}</p>
            {shop.phone ? (
              <a
                href={`tel:${shop.phone}`}
                className="mt-1 text-sm font-medium text-accent-text underline-offset-2 hover:underline"
              >
                {tEmbed('empty.call', { phone: shop.phone })}
              </a>
            ) : null}
          </div>
        </div>
      ) : (
        <EmbedWizard
          locale={locale}
          shopSlug={shopSlug}
          shop={shop}
          hours={hours}
          daysOff={daysOff}
          barbers={barbers}
          services={services}
          categories={categories}
          widgetConfig={widgetConfig}
          tipsConfig={tipsConfig}
        />
      )}
    </>
  );
}
