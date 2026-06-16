import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentShopId, requireShopMember } from '@/lib/auth/server';
import { ShopDetailsClient, type ShopFullRow, type ShopHourRow } from './shop-details-client';

export const dynamic = 'force-dynamic';

export default async function ShopDetailsPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  await requireShopMember({ locale });

  // SOP-12 — scope to the active shop. RLS alone returns the union of the
  // member's shops, so a multi-shop user saw an arbitrary one here while
  // writes target ctx.shopId. The null guard is TS-only (requireShopMember
  // redirected if no membership).
  const shopId = await getCurrentShopId();
  if (!shopId) return null;

  const supabase = createSupabaseServerClient();
  const [shopRes, hoursRes] = await Promise.all([
    supabase
      .from('shops')
      // Explicit projection of exactly the columns ShopFullRow
      // (= ShopDetailsInput + id) feeds to the form — no `select('*')`
      // shipping unused/sensitive columns (smtp/twilio/stripe secrets, etc.).
      .select(
        'id, name, alias, website, phone, email, instagram, yelp_id, timezone, date_format, default_language, default_cash_drawer_balance, description, country, street, street2, municipality, province, postal_code, age_21_only, allow_booking_any_barber, gross_up_fees, use_prod_price_in_tips, use_taxes_in_tips, client_reviews, payout_discount_mode, marketing_banner_enabled, marketing_banner_text, email_logo_url, email_accent_color',
      )
      .eq('id', shopId)
      .maybeSingle(),
    supabase
      .from('shop_hours')
      .select('*')
      .eq('shop_id', shopId)
      .order('weekday', { ascending: true }),
  ]);
  // Contract cast: ShopFullRow narrows `default_language` to 'en' | 'fr'
  // (CHECK-constrained text column, generated as plain string).
  const shop = shopRes.data as ShopFullRow | null;
  const hours = hoursRes.data ?? [];

  if (!shop) {
    return (
      <div className="p-6 text-sm text-text-secondary">
        No shop record found. Run the seed first.
      </div>
    );
  }

  return <ShopDetailsClient shop={shop} hours={hours} />;
}
