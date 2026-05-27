import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import type { BarberRow, ServiceCategoryRow, ServiceRow } from '@/db/rows';
import { BookingWizard, type BookingShop, type BookingHours } from './booking-wizard';

// Public booking page — cache the rendered output for 60s. The data we
// surface (hours, services, barbers, days off) changes rarely; a one-minute
// staleness window cuts Supabase reads to ~1/min/shop without noticeable UX
// impact. Mutations on `/settings/shop` etc. won't propagate instantly here;
// V1.1 will add `revalidateTag('shop:<alias>')` for surgical invalidation.
export const revalidate = 60;

type Props = { params: { locale: string; shopSlug: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServiceRoleClient() as any;
  const { data } = await supabase
    .from('shops')
    .select('name, description')
    .eq('alias', params.shopSlug)
    .limit(1);
  const shop = ((data as Array<{ name: string; description: string | null }> | null) ?? [])[0];
  if (!shop) return { title: 'Booking' };
  return {
    title: `${shop.name} — Réserver en ligne`,
    description: shop.description ?? `Réserve ton rendez-vous chez ${shop.name}.`,
    openGraph: {
      title: `${shop.name} — Réserver en ligne`,
      description: shop.description ?? undefined,
      type: 'website',
    },
  };
}

export default async function BookingPage({ params: { locale, shopSlug } }: Props) {
  setRequestLocale(locale);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServiceRoleClient() as any;

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
      'id, name, alias, description, timezone, date_format, allow_booking_any_barber, country, street, municipality, province, postal_code, logo_url, marketing_banner_enabled, marketing_banner_text',
    )
    .eq('alias', shopSlug)
    .limit(1);
  const shop = ((shopRes.data as BookingShop[] | null) ?? [])[0];
  if (!shop) notFound();

  // 2. Concurrently fetch hours, days_off, barbers, services, categories.
  const [hoursRes, daysOffRes, barbersRes, servicesRes, categoriesRes] = await Promise.all([
    supabase
      .from('shop_hours')
      .select('weekday, enabled, open_time, close_time')
      .eq('shop_id', shop.id)
      .order('weekday', { ascending: true }),
    supabase.from('shop_days_off').select('date').eq('shop_id', shop.id),
    supabase
      .from('barbers')
      .select('id, display_name, avatar_url, sort_order, status')
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
  ]);

  const hours = (hoursRes.data as BookingHours[] | null) ?? [];
  const daysOff = ((daysOffRes.data as Array<{ date: string }> | null) ?? []).map((d) => d.date);
  const barbers = ((barbersRes.data as BarberRow[] | null) ?? []).filter(
    (b) => b.status === 'confirmed',
  );
  const services = ((servicesRes.data as ServiceRow[] | null) ?? []).filter(
    (s) => s.status === 'enabled',
  );
  const categories = (categoriesRes.data as ServiceCategoryRow[] | null) ?? [];

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
          className="border-accent/30 mb-6 rounded-xl border bg-accent-subtle p-4 text-center text-sm text-text-primary shadow-sm"
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
      />
    </>
  );
}
