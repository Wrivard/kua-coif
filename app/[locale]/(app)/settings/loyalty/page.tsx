import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireShopMember } from '@/lib/auth/server';
import type { LoyaltyProgramRow } from '@/db/rows';
import { LoyaltyClient } from './loyalty-client';

export const dynamic = 'force-dynamic';

export default async function LoyaltyPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  await requireShopMember({ locale });

  const supabase = createSupabaseServerClient();
  const { data } = await supabase.from('loyalty_program').select('*').limit(1);
  const row = (data as LoyaltyProgramRow[] | null)?.[0] ?? null;
  return <LoyaltyClient row={row} />;
}
