import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireShopMember } from '@/lib/auth/server';
import { WaitingListClient } from './waiting-list-client';

export const dynamic = 'force-dynamic';

export default async function WaitingListPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  setRequestLocale(locale);
  await requireShopMember({ locale });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServerClient() as any;
  const { data } = await supabase.from('waiting_list_config').select('*').limit(1);
  const row = (data as Array<{ enabled: boolean; threshold_hours: number }> | null)?.[0] ?? null;
  return <WaitingListClient initial={row ?? { enabled: false, threshold_hours: 3 }} />;
}
