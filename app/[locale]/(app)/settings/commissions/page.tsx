import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentShopId, requireShopMember } from '@/lib/auth/server';
import type { BarberRow, CommissionTierRow } from '@/db/rows';
import { CommissionsClient } from './commissions-client';

export const dynamic = 'force-dynamic';

export default async function CommissionsPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  await requireShopMember({ locale });

  const shopId = await getCurrentShopId();
  if (!shopId) {
    return <CommissionsClient barbers={[]} tiers={[]} />;
  }

  const supabase = createSupabaseServerClient();
  const [barbersRes, tiersRes] = await Promise.all([
    supabase
      .from('barbers')
      .select('*')
      .eq('shop_id', shopId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('commission_tiers')
      .select('*')
      .eq('shop_id', shopId)
      .order('barber_id', { ascending: true }),
  ]);

  const barbers = (barbersRes.data ?? []).filter((b) => b.status === 'confirmed');
  const tiers = tiersRes.data ?? [];

  return <CommissionsClient barbers={barbers} tiers={tiers} />;
}
