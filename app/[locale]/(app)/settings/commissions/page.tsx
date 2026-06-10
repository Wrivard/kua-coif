import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireShopMember } from '@/lib/auth/server';
import type { BarberRow, CommissionTierRow } from '@/db/rows';
import { CommissionsClient } from './commissions-client';

export const dynamic = 'force-dynamic';

export default async function CommissionsPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  await requireShopMember({ locale });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServerClient() as any;
  const [barbersRes, tiersRes] = await Promise.all([
    supabase.from('barbers').select('*').order('sort_order', { ascending: true }),
    supabase.from('commission_tiers').select('*'),
  ]);

  const barbers = ((barbersRes.data as BarberRow[] | null) ?? []).filter(
    (b) => b.status === 'confirmed',
  );
  const tiers = (tiersRes.data as CommissionTierRow[] | null) ?? [];

  return <CommissionsClient barbers={barbers} tiers={tiers} />;
}
