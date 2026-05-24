import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireShopMember } from '@/lib/auth/server';
import type { DiscountRow } from '@/db/rows';
import { DiscountsClient } from './discounts-client';

export const dynamic = 'force-dynamic';

export default async function DiscountsPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  setRequestLocale(locale);
  await requireShopMember({ locale });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServerClient() as any;
  const { data } = await supabase.from('discounts').select('*').order('name', { ascending: true });
  return <DiscountsClient locale={locale} discounts={(data as DiscountRow[] | null) ?? []} />;
}
