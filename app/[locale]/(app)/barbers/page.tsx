import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireShopMember } from '@/lib/auth/server';
import type { BarberRow } from '@/db/rows';
import { BarbersClient } from './barbers-client';

export const dynamic = 'force-dynamic';

export default async function BarbersPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  await requireShopMember({ locale });

  const supabase = createSupabaseServerClient();
  const result = await (
    supabase as unknown as {
      from: (t: string) => {
        select: (cols: string) => {
          order: (
            k: string,
            opts?: { ascending?: boolean },
          ) => Promise<{ data: unknown; error: unknown }>;
        };
      };
    }
  )
    .from('barbers')
    .select('*')
    .order('sort_order', { ascending: true });

  const barbers = (result.data as BarberRow[] | null) ?? [];
  return <BarbersClient locale={locale} barbers={barbers} />;
}
