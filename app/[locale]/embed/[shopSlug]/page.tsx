import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import type { BarberRow, ServiceCategoryRow, ServiceRow } from '@/db/rows';
import { displayNameFor, parseWidgetConfig, widgetThemeCss } from '@/lib/business/widget-config';
import type { TipsConfig } from '@/lib/business/tips';
import {
  BookingWizard,
  type BookingShop,
  type BookingHours,
} from '../../book/[shopSlug]/booking-wizard';
import { WidgetResizeEmitter } from './widget-resize-emitter';
import { PreviewWrapper } from './preview-wrapper';

// Embed widget — same caching strategy as `/book/[shopSlug]` (60s ISR). The
// widget is loaded inside an iframe on third-party sites, so we want it to
// respond fast and not hammer Supabase on every page load.
export const revalidate = 60;

type Props = {
  params: { locale: string; shopSlug: string };
  // Loop 66 — `?preview=1` opts into the live-preview listener mounted
  // by the /settings/widget admin iframe. Public widget.js loads never
  // pass this flag, so the listener is dead code for third-party
  // visitors (zero JS sent down to them).
  searchParams?: { preview?: string };
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
 * automatically. Loaded inside an iframe injected by `public/widget.js` (or
 * directly in the admin live-preview pane).
 */
export default async function EmbedBookingPage({
  params: { locale, shopSlug },
  searchParams,
}: Props) {
  setRequestLocale(locale);
  const isPreview = searchParams?.preview === '1';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServiceRoleClient() as any;

  // 1. Resolve shop by alias.
  // Phase H+10 — `phone` added to the select so the widget header
  // can render a tap-to-call line when `widget_config.show_phone`
  // is on. Always queried (not gated on the config) so the preview
  // wrapper can flip the toggle live without a network round-trip.
  const shopRes = await supabase
    .from('shops')
    .select(
      'id, name, alias, description, timezone, date_format, allow_booking_any_barber, country, street, municipality, province, postal_code, phone, logo_url, widget_config',
    )
    .eq('alias', shopSlug)
    .limit(1);
  const shopRow = ((shopRes.data as Array<BookingShop & { widget_config: unknown }> | null) ??
    [])[0];
  if (!shopRow) notFound();

  const widgetConfig = parseWidgetConfig(shopRow.widget_config);

  // 2. Fetch everything the wizard needs, scoped to the shop.
  //    Phase E — `tips_config` for the in-widget tip selector. The
  //    wizard hides the tip section when this row is missing.
  const [hoursRes, daysOffRes, barbersRes, servicesRes, categoriesRes, tipsRes] = await Promise.all(
    [
      supabase
        .from('shop_hours')
        .select('weekday, enabled, open_time, close_time')
        .eq('shop_id', shopRow.id)
        .order('weekday', { ascending: true }),
      supabase.from('shop_days_off').select('date').eq('shop_id', shopRow.id),
      supabase
        .from('barbers')
        .select('id, display_name, avatar_url, sort_order, status')
        .eq('shop_id', shopRow.id)
        .order('sort_order', { ascending: true }),
      supabase
        .from('services')
        .select('id, category_id, name, duration_min, price, status, sort_order')
        .eq('shop_id', shopRow.id)
        .order('sort_order', { ascending: true }),
      supabase
        .from('service_categories')
        .select('id, name, sort_order')
        .eq('shop_id', shopRow.id)
        .order('sort_order', { ascending: true }),
      supabase
        .from('tips_config')
        .select(
          'round_up, pct_tier1, pct_tier2, pct_tier3, pct_tier4, pct_use_above_amount, flat_tier1, flat_tier2, flat_tier3, flat_tier4',
        )
        .eq('shop_id', shopRow.id)
        .limit(1),
    ],
  );

  const hours = (hoursRes.data as BookingHours[] | null) ?? [];
  const daysOff = ((daysOffRes.data as Array<{ date: string }> | null) ?? []).map((d) => d.date);
  const tipsConfig = ((tipsRes.data as TipsConfig[] | null) ?? [])[0];
  const barbers = ((barbersRes.data as BarberRow[] | null) ?? []).filter(
    (b) => b.status === 'confirmed',
  );
  const services = ((servicesRes.data as ServiceRow[] | null) ?? []).filter(
    (s) => s.status === 'enabled',
  );
  const categories = (categoriesRes.data as ServiceCategoryRow[] | null) ?? [];

  // The shop name shown in the wizard header can be overridden by the widget
  // config (e.g. "Book at Axum" instead of "Axum barbershop").
  // Phase H+10 — `phone` joins the privacy-redaction set so the new
  // header phone line obeys `widget_config.show_phone`. Public (non-
  // preview) embed renders this redacted version directly. Preview
  // mode bypasses this and feeds the wrapper the unredacted `shopRow`
  // so live toggles can flip address/phone on without a save.
  // Phase H+11 — locale-aware display name (FR/EN overrides with the
  // legacy single field as fallback, then the shop's row.name).
  const localeBucket: 'fr' | 'en' = locale === 'en' ? 'en' : 'fr';
  const displayNameOverride = displayNameFor(widgetConfig, localeBucket);
  const shop: BookingShop = {
    ...shopRow,
    name: displayNameOverride || shopRow.name,
    street: widgetConfig.show_address ? shopRow.street : null,
    municipality: widgetConfig.show_address ? shopRow.municipality : null,
    province: widgetConfig.show_address ? shopRow.province : null,
    phone: widgetConfig.show_phone ? (shopRow.phone ?? null) : null,
  };

  const themeCss = widgetThemeCss(widgetConfig);

  // Loop 65 — widget theme override.
  //
  // Until now the embed iframe's theme was determined by the Loop 60
  // FOUC init script in the root layout, which reads localStorage +
  // prefers-color-scheme. For a third-party-site visitor opening the
  // widget for the first time, localStorage is empty → the customer's
  // OS preference wins, regardless of what the shop owner picked in
  // /settings/widget. The "Color mode: Dark" setting was cosmetic.
  //
  // The script below runs AFTER the root layout's init script (later
  // in the document) and BEFORE React hydrates, so it overrides the
  // `data-theme` attribute synchronously. For `mode === 'auto'` we
  // intentionally do nothing — the root script's prefers-color-scheme
  // detection is the right behavior.
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
      {themeCss ? (
        // eslint-disable-next-line react/no-danger
        <style dangerouslySetInnerHTML={{ __html: themeCss }} />
      ) : null}
      <WidgetResizeEmitter />
      {/* Phase H+10 — full live preview supersedes Loop 66's narrower
       *  theme-only listener. In preview mode, `PreviewWrapper` holds
       *  the WidgetConfig as React state, derives shop + applies
       *  theme reactively, and re-renders the wizard on every parent
       *  postMessage broadcast. Public embed loads bypass it entirely
       *  and render the saved-config-derived `shop` directly. */}
      {isPreview ? (
        <PreviewWrapper
          initialConfig={widgetConfig}
          rawShop={shopRow as BookingShop}
          locale={locale}
          shopSlug={shopSlug}
          hours={hours}
          daysOff={daysOff}
          barbers={barbers}
          services={services}
          categories={categories}
          tipsConfig={tipsConfig}
        />
      ) : (
        <BookingWizard
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
