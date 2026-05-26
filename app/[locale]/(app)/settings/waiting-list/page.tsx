import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireShopMember } from '@/lib/auth/server';
import { WaitingListClient, type WaitlistEntry } from './waiting-list-client';

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

  // Phase 53 — load both the per-shop config AND the queue of entries
  // currently waiting. The list is bounded (most shops won't have more
  // than a few dozen entries at a time) so no pagination yet — we sort
  // by created_at desc and cap at 100.
  const [configRes, entriesRes, barbersRes] = await Promise.all([
    supabase.from('waiting_list_config').select('*').limit(1),
    supabase
      .from('waiting_list_entries')
      .select(
        'id, first_name, last_name, email, phone, preferred_barber_id, service_ids, date_window_start, date_window_end, notes, status, created_at, notified_at',
      )
      .order('created_at', { ascending: false })
      .limit(100),
    supabase.from('barbers').select('id, display_name'),
  ]);

  const configRow =
    (configRes.data as Array<{ enabled: boolean; threshold_hours: number }> | null)?.[0] ?? null;
  const entries = (entriesRes.data as WaitlistEntry[] | null) ?? [];
  const barbers = (barbersRes.data as Array<{ id: string; display_name: string }> | null) ?? [];

  return (
    <WaitingListClient
      initial={configRow ?? { enabled: false, threshold_hours: 3 }}
      entries={entries}
      barbers={barbers}
    />
  );
}
