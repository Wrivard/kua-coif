import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { parseWidgetConfig } from '@/lib/business/widget-config';
import type { TipsConfig } from '@/lib/business/tips';
import type { BarberRow, ServiceCategoryRow, ServiceRow } from '@/db/rows';
import { BookingWizard, type BookingShop, type BookingHours } from './booking-wizard';
import { ReviewsSection, type PublicReview } from './reviews-section';

// Public booking page — cache the rendered output for 60s. The data we
// surface (hours, services, barbers, days off) changes rarely; a one-minute
// staleness window cuts Supabase reads to ~1/min/shop without noticeable UX
// impact. Mutations on `/settings/shop` etc. won't propagate instantly here;
// V1.1 will add `revalidateTag('shop:<alias>')` for surgical invalidation.
export const revalidate = 60;

type Props = { params: Promise<{ locale: string; shopSlug: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const supabase = createSupabaseServiceRoleClient();
  const { data } = await supabase
    .from('shops')
    .select('name, description')
    .eq('alias', params.shopSlug)
    .limit(1);
  const shop = (data ?? [])[0];
  if (!shop) return { title: 'Booking' };
  // BUG-07 — localize the title/description on the route locale instead of
  // hardcoding French, so EN share links / browser tabs / search snippets read
  // English. The shop's own `description` still overrides when present.
  const t = await getTranslations({ locale: params.locale, namespace: 'pages.booking.meta' });
  const title = t('title', { name: shop.name });
  return {
    title,
    description: shop.description ?? t('description', { name: shop.name }),
    openGraph: {
      title,
      description: shop.description ?? undefined,
      type: 'website',
    },
  };
}

export default async function BookingPage(props: Props) {
  const params = await props.params;

  const { locale, shopSlug } = params;

  setRequestLocale(locale);

  const supabase = createSupabaseServiceRoleClient();

  // 1. Resolve shop by alias. This is a public read — the shop row needs an
  //    RLS exception for non-authenticated visitors. For V1 we rely on the
  //    fact that `shop` is read only for the wizard render (no sensitive data
  //    exposed here besides hours/services/barbers — which are inherently
  //    public when you offer online booking).
  const shopRes = await supabase
    .from('shops')
    .select(
      // Loop 65 — `logo_url` added so the wizard header can render
      // the shop's actual logo instead of the "K" Küa fallback.
      // Phase E — `widget_config` for the show_tip_step toggle,
      // plumbed here so /book matches the embed surface. The widget
      // config is otherwise unused on /book today; that's fine, the
      // wizard ignores fields it doesn't recognize.
      'id, name, alias, description, timezone, date_format, allow_booking_any_barber, country, street, municipality, province, postal_code, logo_url, marketing_banner_enabled, marketing_banner_text, widget_config',
    )
    .eq('alias', shopSlug)
    .limit(1);
  const shopRow = ((shopRes.data as Array<BookingShop & { widget_config: unknown }> | null) ??
    [])[0];
  if (!shopRow) notFound();
  const { widget_config: shopWidgetConfigRaw, ...shop } = shopRow;
  const widgetConfig = parseWidgetConfig(shopWidgetConfigRaw);

  // 2. Concurrently fetch hours, days_off, barbers, services, categories.
  //    Phase E adds `tips_config` for the in-widget tip selector.
  const [hoursRes, daysOffRes, barbersRes, servicesRes, categoriesRes, tipsRes, reviewsRes] =
    await Promise.all([
      supabase
        .from('shop_hours')
        .select('weekday, enabled, open_time, close_time')
        .eq('shop_id', shop.id)
        .order('weekday', { ascending: true }),
      supabase.from('shop_days_off').select('date').eq('shop_id', shop.id),
      supabase
        .from('barbers')
        .select('id, display_name, avatar_url, sort_order, status, bookable')
        .eq('shop_id', shop.id)
        .order('sort_order', { ascending: true }),
      supabase
        .from('services')
        .select('id, category_id, name, duration_min, price, status, sort_order')
        .eq('shop_id', shop.id)
        .order('sort_order', { ascending: true }),
      supabase
        .from('service_categories')
        .select('id, name, sort_order')
        .eq('shop_id', shop.id)
        .order('sort_order', { ascending: true }),
      supabase
        .from('tips_config')
        .select(
          'round_up, pct_tier1, pct_tier2, pct_tier3, pct_tier4, pct_use_above_amount, flat_tier1, flat_tier2, flat_tier3, flat_tier4',
        )
        .eq('shop_id', shop.id)
        .limit(1),
      // Published reviews via the public-safe `reviews_public` view
      // (security audit #6). The view already filters status='published'
      // and exposes only safe columns (no client_id / barber_id). We cap
      // at 20 most-recent rows: enough to compute a representative average
      // + show a few snippets without paging the whole history.
      supabase
        .from('reviews_public')
        .select('id, rating, comment, client_name, created_at')
        .eq('shop_id', shop.id)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

  const hours = (hoursRes.data as BookingHours[] | null) ?? [];
  const daysOff = ((daysOffRes.data as Array<{ date: string }> | null) ?? []).map((d) => d.date);
  const tipsConfig = ((tipsRes.data as TipsConfig[] | null) ?? [])[0];
  const barbers = ((barbersRes.data as BarberRow[] | null) ?? []).filter(
    // B17 — public booking shows only confirmed AND bookable barbers.
    (b) => b.status === 'confirmed' && b.bookable,
  );
  const services = ((servicesRes.data as ServiceRow[] | null) ?? []).filter(
    (s) => s.status === 'enabled',
  );
  const categories = (categoriesRes.data as ServiceCategoryRow[] | null) ?? [];
  const reviews = (reviewsRes.data as PublicReview[] | null) ?? [];

  // Schema.org structured data — Hairdresser (subtype of LocalBusiness)
  // helps Google show rich results for the shop's name, address, hours.
  const dayMap: Record<number, string> = {
    0: 'Sunday',
    1: 'Monday',
    2: 'Tuesday',
    3: 'Wednesday',
    4: 'Thursday',
    5: 'Friday',
    6: 'Saturday',
  };
  const openingHoursSpec = hours
    .filter((h) => h.enabled && h.open_time && h.close_time)
    .map((h) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: dayMap[h.weekday] ?? 'Monday',
      opens: h.open_time,
      closes: h.close_time,
    }));
  const ldJson = {
    '@context': 'https://schema.org',
    '@type': 'HairSalon',
    name: shop.name,
    description: shop.description ?? undefined,
    address: shop.street
      ? {
          '@type': 'PostalAddress',
          streetAddress: shop.street,
          addressLocality: shop.municipality ?? undefined,
          addressRegion: shop.province ?? undefined,
          postalCode: shop.postal_code ?? undefined,
          addressCountry: shop.country ?? undefined,
        }
      : undefined,
    openingHoursSpecification: openingHoursSpec,
  };

  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ldJson) }}
      />
      {/* Phase 64 — owner-controlled marketing banner. Renders only
          when the shop has flipped the toggle in /settings/shop AND
          has set a non-empty message. Uses the accent-subtle palette
          so it feels brand-aligned without competing with the wizard. */}
      {shop.marketing_banner_enabled && shop.marketing_banner_text ? (
        <div
          role="status"
          className="mb-6 rounded-xl border border-accent/30 bg-accent-subtle p-4 text-center text-sm text-text-primary shadow-warm-sm"
        >
          {shop.marketing_banner_text}
        </div>
      ) : null}
      <BookingWizard
        locale={locale}
        shopSlug={shopSlug}
        shop={shop}
        hours={hours}
        daysOff={daysOff}
        barbers={barbers}
        services={services}
        categories={categories}
        // Phase E — both surfaces (/book and /embed) now share the
        // widget_config + tips_config so the in-widget tip step
        // behaves identically. The wizard hides the section when
        // either piece is missing.
        widgetConfig={widgetConfig}
        tipsConfig={tipsConfig}
        // Phase H+14 — the hosted booking page is NOT the embeddable
        // widget. Passing `null` keeps its traffic out of the widget
        // conversion funnel (/settings/widget), which would otherwise
        // log every /book visit as a `source='direct'` impression and
        // conflate it with bare /embed loads.
        analyticsSource={null}
      />
      {/* Social proof — published reviews surfaced below the wizard so
          customers who are still deciding can read recent feedback. The
          section self-hides when the shop has no published reviews. */}
      <ReviewsSection reviews={reviews} locale={locale} />
    </>
  );
}
