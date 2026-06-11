import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireShopMember } from '@/lib/auth/server';
import { ShopDetailsClient, type ShopFullRow, type ShopHourRow } from './shop-details-client';

export const dynamic = 'force-dynamic';

export default async function ShopDetailsPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  await requireShopMember({ locale });

  const supabase = createSupabaseServerClient();
  const [shopRes, hoursRes] = await Promise.all([
    supabase.from('shops').select('*').limit(1),
    supabase.from('shop_hours').select('*').order('weekday', { ascending: true }),
  ]);
  // Contract cast: ShopFullRow narrows `default_language` to 'en' | 'fr'
  // (CHECK-constrained text column, generated as plain string).
  const shop = ((shopRes.data as ShopFullRow[] | null) ?? [])[0] ?? null;
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
