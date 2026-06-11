import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireShopMember } from '@/lib/auth/server';
import type { DiscountRow } from '@/db/rows';
import { DiscountsClient } from './discounts-client';

export const dynamic = 'force-dynamic';

export default async function DiscountsPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  await requireShopMember({ locale });

  const supabase = createSupabaseServerClient();
  const { data } = await supabase.from('discounts').select('*').order('name', { ascending: true });
  return <DiscountsClient locale={locale} discounts={(data as DiscountRow[] | null) ?? []} />;
}
