import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireShopMember } from '@/lib/auth/server';
import type { TaxRow } from '@/db/rows';
import { TaxesClient } from './taxes-client';

export const dynamic = 'force-dynamic';

export default async function TaxesPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  await requireShopMember({ locale });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServerClient() as any;
  const { data } = await supabase.from('taxes').select('*').order('name', { ascending: true });

  return <TaxesClient taxes={(data as TaxRow[] | null) ?? []} />;
}
