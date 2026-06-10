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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServerClient() as any;
  const [shopRes, hoursRes] = await Promise.all([
    supabase.from('shops').select('*').limit(1),
    supabase.from('shop_hours').select('*').order('weekday', { ascending: true }),
  ]);
  const shop = ((shopRes.data as ShopFullRow[] | null) ?? [])[0] ?? null;
  const hours = (hoursRes.data as ShopHourRow[] | null) ?? [];

  if (!shop) {
    return (
      <div className="p-6 text-sm text-text-secondary">
        No shop record found. Run the seed first.
      </div>
    );
  }

  return <ShopDetailsClient shop={shop} hours={hours} />;
}
