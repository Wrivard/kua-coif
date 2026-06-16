import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  getCurrentBarberId,
  getCurrentShopId,
  getShopMemberships,
  requireShopMember,
} from '@/lib/auth/server';
import type { ClientRow } from '@/db/rows';
import { ClientsClient } from './clients-client';

export const dynamic = 'force-dynamic';

export default async function ClientsPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  await requireShopMember({ locale });

  // Resolve the ACTIVE shop (cookie-aware), not memberships[0]: a multi-shop
  // owner/manager must see ONLY the active shop's clients, and every query is
  // EXPLICITLY scoped to shopId rather than leaning on is_shop_member RLS
  // (which spans ALL of the user's shops → a merged cross-shop PII roster).
  // Phase H+5 — strict barber scope: a barber only sees clients they've
  // actually served (≥1 appointment as barber_id). Owners + managers see
  // every client in the active shop.
  // getCurrentShopId() re-resolves memberships internally via the React
  // cache(), so it does not consume the local `memberships`; the two are
  // independent and run in one round-trip.
  const [memberships, activeShopId] = await Promise.all([getShopMemberships(), getCurrentShopId()]);
  const activeMembership = memberships.find((m) => m.shop_id === activeShopId) ?? memberships[0];
  const shopId = activeMembership?.shop_id ?? activeShopId;
  if (!shopId) throw new Error('Clients load failed: no active shop resolved');
  const viewerRole = activeMembership?.role ?? 'barber';
  const viewerBarberId = viewerRole === 'barber' ? await getCurrentBarberId() : null;

  const supabase = createSupabaseServerClient();

  // V1 bound: cap the roster fetch at an explicit, deterministic number
  // instead of PostgREST's silent 1000-row default. Real server-side
  // pagination + search (so shops past the cap stay fully browsable +
  // findable) lands in the next wave; for now the in-memory A–Z/search/
  // dedup operate on a bounded set.
  const CLIENT_FETCH_CAP = 1000;

  // The 2-counter model (spec §B: "TOTAL A-Z (1896)" vs "TOTAL (227)"):
  // `totalCount` is the shop's GRAND total (a real COUNT, uncapped), shown in
  // the header; the table footer's filtered count + page-of is the second
  // counter. `clients.length` (the capped fetch) would undercount past the cap.
  let clients: ClientRow[] = [];
  let totalCount = 0;
  if (viewerRole === 'barber' && viewerBarberId) {
    // Two-step: first the appointment.client_id distinct list for this
    // barber, then the client rows for those ids.
    const apptIdsRes = await supabase
      .from('appointments')
      .select('client_id')
      .eq('shop_id', shopId)
      .eq('barber_id', viewerBarberId)
      .not('client_id', 'is', null)
      // Bound the scan: a barber's ACTIVE clients live in their RECENT
      // appointments, so take the 2000 most recent (≈ a year at ~8/day) rather
      // than rely on PostgREST's silent 1000-row cap on an unordered scan.
      .order('start_at', { ascending: false })
      .limit(2000);
    const clientIds = Array.from(
      new Set(
        (apptIdsRes.data ?? []).map((r) => r.client_id).filter((id): id is string => Boolean(id)),
      ),
    );
    // Grand total for a barber = the distinct clients they've served (the
    // uncapped id list), not the capped row fetch below.
    totalCount = clientIds.length;
    if (clientIds.length > 0) {
      const res = await supabase
        .from('clients')
        .select('id, first_name, last_name, email, phone, date_of_birth, notes')
        .eq('shop_id', shopId)
        .in('id', clientIds)
        .order('first_name', { ascending: true })
        .limit(CLIENT_FETCH_CAP);
      clients = (res.data as ClientRow[] | null) ?? [];
    }
  } else {
    // Grand total = a real COUNT over the whole shop (head:true → no rows
    // transferred), independent of the capped fetch.
    const countRes = await supabase
      .from('clients')
      .select('id', { count: 'exact', head: true })
      .eq('shop_id', shopId);
    totalCount = countRes.count ?? 0;
    const res = await supabase
      .from('clients')
      .select('id, first_name, last_name, email, phone, date_of_birth, notes')
      .eq('shop_id', shopId)
      .order('first_name', { ascending: true })
      .limit(CLIENT_FETCH_CAP);
    if (res.error) {
      throw new Error(`Clients load failed: ${res.error.message ?? res.error}`);
    }
    clients = (res.data as ClientRow[] | null) ?? [];
  }

  // Managers + owners can merge duplicates (the action is manager+ too).
  return (
    <ClientsClient
      locale={locale}
      clients={clients}
      totalCount={totalCount}
      canManage={viewerRole !== 'barber'}
    />
  );
}
