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

export default async function ClientsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  await requireShopMember({ locale });

  // Resolve the ACTIVE shop (cookie-aware), not memberships[0]: a multi-shop
  // owner/manager must see ONLY the active shop's clients, and every query is
  // EXPLICITLY scoped to shopId rather than leaning on is_shop_member RLS
  // (which spans ALL of the user's shops → a merged cross-shop PII roster).
  // Phase H+5 — strict barber scope: a barber only sees clients they've
  // actually served (≥1 appointment as barber_id). Owners + managers see
  // every client in the active shop.
  const memberships = await getShopMemberships();
  const activeShopId = await getCurrentShopId();
  const activeMembership = memberships.find((m) => m.shop_id === activeShopId) ?? memberships[0];
  const shopId = activeMembership?.shop_id ?? activeShopId;
  if (!shopId) throw new Error('Clients load failed: no active shop resolved');
  const viewerRole = activeMembership?.role ?? 'barber';
  const viewerBarberId = viewerRole === 'barber' ? await getCurrentBarberId() : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServerClient() as any;

  // V1 bound: cap the roster fetch at an explicit, deterministic number
  // instead of PostgREST's silent 1000-row default. Real server-side
  // pagination + search (so shops past the cap stay fully browsable +
  // findable) lands in the next wave; for now the in-memory A–Z/search/
  // dedup operate on a bounded set.
  const CLIENT_FETCH_CAP = 1000;

  let clients: ClientRow[] = [];
  if (viewerRole === 'barber' && viewerBarberId) {
    // Two-step: first the appointment.client_id distinct list for this
    // barber, then the client rows for those ids.
    const apptIdsRes = await supabase
      .from('appointments')
      .select('client_id')
      .eq('shop_id', shopId)
      .eq('barber_id', viewerBarberId)
      .not('client_id', 'is', null);
    const clientIds = Array.from(
      new Set(
        ((apptIdsRes.data as Array<{ client_id: string | null }> | null) ?? [])
          .map((r) => r.client_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );
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
    const res = await supabase
      .from('clients')
      .select('id, first_name, last_name, email, phone, date_of_birth, notes')
      .eq('shop_id', shopId)
      .order('first_name', { ascending: true })
      .limit(CLIENT_FETCH_CAP);
    if (res.error) {
      throw new Error(
        `Clients load failed: ${(res.error as { message?: string }).message ?? res.error}`,
      );
    }
    clients = (res.data as ClientRow[] | null) ?? [];
  }

  return <ClientsClient locale={locale} clients={clients} />;
}
