import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import type { BarberRow, ServiceCategoryRow, ServiceRow } from '@/db/rows';
import { displayNameFor, parseWidgetConfig, type WidgetConfig } from '@/lib/business/widget-config';
import type { TipsConfig } from '@/lib/business/tips';
import type { BookingShop, BookingHours } from '../../book/[shopSlug]/booking-wizard';

export type EmbedData = {
  /** Raw shop row (unredacted) — preview mode needs it for live toggles. */
  shopRow: BookingShop & { widget_config: unknown };
  widgetConfig: WidgetConfig;
  /** Privacy-redacted shop (address/phone gated on the widget config). */
  shop: BookingShop;
  hours: BookingHours[];
  daysOff: string[];
  barbers: BarberRow[];
  services: ServiceRow[];
  categories: ServiceCategoryRow[];
  tipsConfig: TipsConfig | undefined;
};

/**
 * Plan 038 — shared data loader for the embed surface. Extracted from the
 * embed page so the public (ISR) route and the admin live-preview (dynamic)
 * route fetch the exact same shape without duplicating the preamble.
 * Returns null when the alias doesn't resolve — callers notFound().
 */
export async function loadEmbedData(locale: string, shopSlug: string): Promise<EmbedData | null> {
  const supabase = createSupabaseServiceRoleClient();

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
  if (!shopRow) return null;

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
        .select('id, display_name, avatar_url, sort_order, status, bookable')
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
    // B17 — public booking shows only confirmed AND bookable barbers.
    (b) => b.status === 'confirmed' && b.bookable,
  );
  const services = ((servicesRes.data as ServiceRow[] | null) ?? []).filter(
    (s) => s.status === 'enabled',
  );
  const categories = (categoriesRes.data as ServiceCategoryRow[] | null) ?? [];

  // The shop name shown in the wizard header can be overridden by the widget
  // config (e.g. "Book at Axum" instead of "Axum barbershop").
  // Phase H+10 — `phone` joins the privacy-redaction set so the header
  // phone line obeys `widget_config.show_phone`. Public (non-preview)
  // embed renders this redacted version directly; preview mode feeds the
  // wrapper the unredacted `shopRow` so live toggles work without a save.
  // Phase H+11 — locale-aware display name.
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

  return { shopRow, widgetConfig, shop, hours, daysOff, barbers, services, categories, tipsConfig };
}
