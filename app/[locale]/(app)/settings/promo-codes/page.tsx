import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentShopId, requireShopMember } from '@/lib/auth/server';
import { PromoCodesClient, type PromoCodeRow } from './promo-codes-client';

export const dynamic = 'force-dynamic';

export default async function PromoCodesPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  await requireShopMember({ locale });

  const shopId = await getCurrentShopId();
  if (!shopId) {
    return <PromoCodesClient locale={locale} promoCodes={[]} />;
  }

  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from('promo_codes')
    .select('*')
    .eq('shop_id', shopId)
    .order('code', { ascending: true });
  return <PromoCodesClient locale={locale} promoCodes={(data as PromoCodeRow[] | null) ?? []} />;
}
