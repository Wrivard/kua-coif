import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentBarberId, getShopMemberships, requireShopMember } from '@/lib/auth/server';
import type { ClientRow } from '@/db/rows';
import { ClientsClient } from './clients-client';

export const dynamic = 'force-dynamic';

export default async function ClientsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  await requireShopMember({ locale });

  // Phase H+5 — strict barber scope. A barber only sees clients they
  // have actually served (i.e. at least one appointment with them as
  // barber_id). Owners + managers see every client in the shop.
  const memberships = await getShopMemberships();
  const viewerRole = memberships[0]?.role ?? 'barber';
  const viewerBarberId = viewerRole === 'barber' ? await getCurrentBarberId() : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServerClient() as any;

  let clients: ClientRow[] = [];
  if (viewerRole === 'barber' && viewerBarberId) {
    // Two-step: first the appointment.client_id distinct list for this
    // barber, then the client rows for those ids. Postgres can do this
    // as a join but the Supabase JS client makes that awkward; two
    // calls is fine for the V1 client volumes.
    const apptIdsRes = await supabase
      .from('appointments')
      .select('client_id')
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
        .in('id', clientIds)
        .order('first_name', { ascending: true });
      clients = (res.data as ClientRow[] | null) ?? [];
    }
  } else {
    const res = await supabase
      .from('clients')
      .select('id, first_name, last_name, email, phone, date_of_birth, notes')
      .order('first_name', { ascending: true });
    clients = (res.data as ClientRow[] | null) ?? [];
  }

  return <ClientsClient locale={locale} clients={clients} />;
}
