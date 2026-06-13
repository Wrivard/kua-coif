import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentShopId, requireShopMember } from '@/lib/auth/server';
import { WaitingListClient, type WaitlistEntry } from './waiting-list-client';

export const dynamic = 'force-dynamic';

export default async function WaitingListPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  await requireShopMember({ locale });

  // SOP-12 — scope to the active shop. RLS alone returns the union of the
  // member's shops, so a multi-shop user saw another shop's config + entries
  // (PII) here while writes target ctx.shopId. The null guard is TS-only
  // (requireShopMember redirected if no membership).
  const shopId = await getCurrentShopId();
  if (!shopId) return null;

  const supabase = createSupabaseServerClient();

  // Phase 53 — load both the per-shop config AND the queue of entries
  // currently waiting. The list is bounded (most shops won't have more
  // than a few dozen entries at a time) so no pagination yet — we sort
  // by created_at desc and cap at 100.
  const [configRes, entriesRes, barbersRes] = await Promise.all([
    supabase.from('waiting_list_config').select('*').eq('shop_id', shopId).maybeSingle(),
    supabase
      .from('waiting_list_entries')
      .select(
        'id, first_name, last_name, email, phone, preferred_barber_id, service_ids, date_window_start, date_window_end, notes, status, created_at, notified_at',
      )
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('barbers')
      .select('id, display_name')
      .eq('shop_id', shopId)
      .order('sort_order', { ascending: true }),
  ]);

  const configRow = configRes.data ?? null;
  const entries = (entriesRes.data as WaitlistEntry[] | null) ?? [];
  const barbers = barbersRes.data ?? [];

  return (
    <WaitingListClient
      initial={configRow ?? { enabled: false, threshold_hours: 3 }}
      entries={entries}
      barbers={barbers}
    />
  );
}
