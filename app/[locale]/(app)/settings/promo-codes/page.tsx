import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireShopMember } from '@/lib/auth/server';
import { PromoCodesClient, type PromoCodeRow } from './promo-codes-client';

export const dynamic = 'force-dynamic';

export default async function PromoCodesPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  setRequestLocale(locale);
  await requireShopMember({ locale });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServerClient() as any;
  const { data } = await supabase
    .from('promo_codes')
    .select('*')
    .order('code', { ascending: true });
  return <PromoCodesClient locale={locale} promoCodes={(data as PromoCodeRow[] | null) ?? []} />;
}
