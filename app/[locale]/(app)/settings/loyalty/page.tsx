import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentShopId, requireShopMember } from '@/lib/auth/server';
import type { LoyaltyProgramRow } from '@/db/rows';
import { LoyaltyClient } from './loyalty-client';

export const dynamic = 'force-dynamic';

export default async function LoyaltyPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  await requireShopMember({ locale });

  const shopId = await getCurrentShopId();
  if (!shopId) {
    return <LoyaltyClient row={null} />;
  }

  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from('loyalty_program')
    .select('*')
    .eq('shop_id', shopId)
    .maybeSingle();
  const row = (data as LoyaltyProgramRow | null) ?? null;
  return <LoyaltyClient row={row} />;
}
