import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireShopMember } from '@/lib/auth/server';
import type { ClientRow } from '@/db/rows';
import { ClientsClient } from './clients-client';

export const dynamic = 'force-dynamic';

export default async function ClientsPage({ params: { locale } }: { params: { locale: string } }) {
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
    .from('clients')
    .select('*')
    .order('first_name', { ascending: true });

  const clients = (result.data as ClientRow[] | null) ?? [];
  return <ClientsClient locale={locale} clients={clients} />;
}
