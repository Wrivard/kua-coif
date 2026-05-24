import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import type { BarberRow, ServiceCategoryRow, ServiceRow } from '@/db/rows';
import { parseWidgetConfig, widgetThemeCss } from '@/lib/business/widget-config';
import {
  BookingWizard,
  type BookingShop,
  type BookingHours,
} from '../../book/[shopSlug]/booking-wizard';
import { WidgetResizeEmitter } from './widget-resize-emitter';

export const dynamic = 'force-dynamic';

type Props = { params: { locale: string; shopSlug: string } };

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
export default async function EmbedBookingPage({ params: { locale, shopSlug } }: Props) {
  setRequestLocale(locale);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServiceRoleClient() as any;

  // 1. Resolve shop by alias.
  const shopRes = await supabase
    .from('shops')
    .select(
      'id, name, alias, description, timezone, date_format, allow_booking_any_barber, country, street, municipality, province, postal_code, widget_config',
    )
    .eq('alias', shopSlug)
    .limit(1);
  const shopRow = ((shopRes.data as Array<BookingShop & { widget_config: unknown }> | null) ??
    [])[0];
  if (!shopRow) notFound();

  const widgetConfig = parseWidgetConfig(shopRow.widget_config);

  // 2. Fetch everything the wizard needs, scoped to the shop.
  const [hoursRes, daysOffRes, barbersRes, servicesRes, categoriesRes] = await Promise.all([
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

  // The shop name shown in the wizard header can be overridden by the widget
  // config (e.g. "Book at Axum" instead of "Axum barbershop").
  const shop: BookingShop = {
    ...shopRow,
    name: widgetConfig.display_name || shopRow.name,
    // Hide address/phone if config says so. The wizard already gates on `street`
    // being present — easier to just blank the field than thread a new prop.
    street: widgetConfig.show_address ? shopRow.street : null,
    municipality: widgetConfig.show_address ? shopRow.municipality : null,
    province: widgetConfig.show_address ? shopRow.province : null,
  };

  const themeCss = widgetThemeCss(widgetConfig);

  return (
    <>
      {themeCss ? (
        // eslint-disable-next-line react/no-danger
        <style dangerouslySetInnerHTML={{ __html: themeCss }} />
      ) : null}
      <WidgetResizeEmitter />
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
