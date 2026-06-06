import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { verifyToken } from '@/lib/security/signed-tokens';
import { MeClient } from './me-client';

export const dynamic = 'force-dynamic';

/**
 * Phase 68 — Customer self-service page.
 *
 * The customer authenticates via a signed token (`kind: 'me'`,
 * `resourceId: client_id`) embedded in a link the shop owner sends them
 * (V1 generation: ad-hoc; V1.1: auto-include in appointment confirmation
 * email).
 *
 * Loi 25 rights covered:
 *  - Right to access ("right to know what data you hold about me") —
 *    export JSON of the client's row + appointment history.
 *  - Right to be forgotten — anonymize the row (V1.1; not exposed here
 *    yet because the action is irreversible and we want the admin to
 *    walk the customer through it on the phone).
 *
 * Also surfaces the customer's loyalty balance as a "thanks for coming
 * back" hint so they know what's coming on their next visit.
 */
export default async function MePage({
  params: { locale, token },
}: {
  params: { locale: string; token: string };
}) {
  setRequestLocale(locale);

  const payload = verifyToken(decodeURIComponent(token), 'me');
  if (!payload) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServiceRoleClient() as any;
  const clientRes = await supabase
    .from('clients')
    .select(
      'id, shop_id, first_name, last_name, email, phone, loyalty_balance_cents, loyalty_counter, anonymized_at',
    )
    .eq('id', payload.resourceId)
    .limit(1);
  const client = ((clientRes.data as Array<{
    id: string;
    shop_id: string;
    first_name: string;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    loyalty_balance_cents: number | null;
    loyalty_counter: number | null;
    anonymized_at: string | null;
  }> | null) ?? [])[0];
  if (!client) notFound();
  if (client.anonymized_at) notFound();

  // These three reads all key off the already-resolved `client` (shop_id
  // and id) and are independent of each other, so fire them together
  // instead of serially — turns 3 round-trips into 1 wall-clock wait.
  const [shopRes, apptCountRes, upcomingRes] = await Promise.all([
    // Phase G — `timezone` added so the upcoming-appointments card can
    // format the start_at in the shop's local clock.
    supabase.from('shops').select('name, email, phone, timezone').eq('id', client.shop_id).limit(1),
    // Count completed appointments — used as a "X visits" stat on the page.
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .eq('status', 'completed'),
    // Phase G — upcoming appointments (status in {booked, confirmed} AND
    // start_at in the future). These power the self-cancel UI; each row
    // gets a Cancel button on the client. Capped at 10 because a
    // customer with more than 10 future bookings is an edge case and the
    // page is already pretty long.
    supabase
      .from('appointments')
      .select(
        'id, start_at, end_at, status, total_amount, payment_status, payment_intent_id, barber:barbers(display_name), services:appointment_services(services(name, duration_min))',
      )
      .eq('client_id', client.id)
      .in('status', ['booked', 'confirmed'])
      .gte('start_at', new Date().toISOString())
      .order('start_at', { ascending: true })
      .limit(10),
  ]);
  const shop =
    ((shopRes.data as Array<{
      name: string;
      email: string | null;
      phone: string | null;
      timezone: string;
    }> | null) ?? [])[0] ?? null;
  const completedCount = (apptCountRes.count as number | null) ?? 0;
  type UpcomingRow = {
    id: string;
    start_at: string;
    end_at: string;
    status: 'booked' | 'confirmed';
    total_amount: number;
    payment_status: 'unpaid' | 'pending' | 'paid' | 'refunded' | 'failed' | null;
    payment_intent_id: string | null;
    barber: { display_name: string } | null;
    services: Array<{ services: { name: string; duration_min: number } | null }> | null;
  };
  const upcoming = ((upcomingRes.data as UpcomingRow[] | null) ?? []).map((r) => ({
    id: r.id,
    startAt: r.start_at,
    endAt: r.end_at,
    status: r.status,
    totalAmount: Number(r.total_amount ?? 0),
    paymentStatus: r.payment_status ?? 'unpaid',
    hasPaymentIntent: Boolean(r.payment_intent_id),
    barberName: r.barber?.display_name ?? null,
    services: (r.services ?? [])
      .map((s) => s.services)
      .filter((s): s is { name: string; duration_min: number } => Boolean(s))
      .map((s) => ({ name: s.name, durationMin: s.duration_min })),
  }));

  return (
    <MeClient
      locale={locale}
      token={token}
      client={{
        firstName: client.first_name,
        loyaltyBalanceCents: client.loyalty_balance_cents ?? 0,
        completedCount,
      }}
      shop={{
        name: shop?.name ?? '?',
        email: shop?.email ?? null,
        phone: shop?.phone ?? null,
        timezone: shop?.timezone ?? 'America/Toronto',
      }}
      upcoming={upcoming}
    />
  );
}
