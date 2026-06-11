import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { signToken, verifyToken } from '@/lib/security/signed-tokens';
import { effectiveLoyaltyBalanceCents } from '@/lib/business/loyalty';
import { resolveEffectiveBarberSettings } from '@/lib/business/barber-settings';
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
export default async function MePage(props: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const params = await props.params;

  const { locale, token } = params;

  setRequestLocale(locale);

  const payload = verifyToken(decodeURIComponent(token), 'me');
  if (!payload) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServiceRoleClient() as any;
  const clientRes = await supabase
    .from('clients')
    .select(
      // Plan 037 (CORRECTNESS-02) — `loyalty_balance_expires_at` widened in so
      // the hero can show the EFFECTIVE balance (expired credit reads as 0).
      'id, shop_id, first_name, last_name, email, phone, loyalty_balance_cents, loyalty_balance_expires_at, loyalty_counter, anonymized_at, me_token_version',
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
    loyalty_balance_expires_at: string | null;
    loyalty_counter: number | null;
    anonymized_at: string | null;
    me_token_version: number | null;
  }> | null) ?? [])[0];
  if (!client) notFound();
  if (client.anonymized_at) notFound();
  // Revocation (W5c): the token's embedded version must match the client's
  // current one; a bump invalidates every outstanding /me link.
  if ((payload.ver ?? 0) !== (client.me_token_version ?? 0)) notFound();

  // These three reads all key off the already-resolved `client` (shop_id
  // and id) and are independent of each other, so fire them together
  // instead of serially — turns 3 round-trips into 1 wall-clock wait.
  const [shopRes, apptCountRes, upcomingRes, settingsRes] = await Promise.all([
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
    //
    // Plan 044 — `barber_id` + `public_link_version` + `deposit_amount_cents`
    // widened in: barber_id resolves the per-appointment cancel policy,
    // public_link_version signs the per-appointment reschedule/receipt
    // tokens, deposit_amount_cents states the exact amount at stake in the
    // cancel dialog.
    supabase
      .from('appointments')
      .select(
        'id, barber_id, start_at, end_at, status, total_amount, payment_status, payment_intent_id, public_link_version, deposit_amount_cents, barber:barbers(display_name), services:appointment_services(services(name, duration_min))',
      )
      .eq('client_id', client.id)
      .in('status', ['booked', 'confirmed'])
      .gte('start_at', new Date().toISOString())
      .order('start_at', { ascending: true })
      .limit(10),
    // Plan 044 (UX-03) — the shop's cancellation policy rows, resolved
    // per-appointment below (same select + resolver as the cancel action,
    // so the cutoff shown always matches the refund decision the server
    // will actually make).
    supabase
      .from('barber_settings')
      .select('scope, barber_id, mins_cancel_before_appt, customer_cancellations')
      .eq('shop_id', client.shop_id),
  ]);
  const shop =
    ((shopRes.data as Array<{
      name: string;
      email: string | null;
      phone: string | null;
      timezone: string;
    }> | null) ?? [])[0] ?? null;
  const completedCount = (apptCountRes.count as number | null) ?? 0;
  const settingsRows =
    (settingsRes.data as Array<{
      scope: 'shop' | 'barber';
      barber_id: string | null;
      mins_cancel_before_appt: number;
      customer_cancellations: boolean | null;
    }> | null) ?? [];
  type UpcomingRow = {
    id: string;
    barber_id: string;
    start_at: string;
    end_at: string;
    status: 'booked' | 'confirmed';
    total_amount: number;
    payment_status: 'unpaid' | 'pending' | 'paid' | 'refunded' | 'failed' | null;
    payment_intent_id: string | null;
    public_link_version: number | null;
    deposit_amount_cents: number | null;
    barber: { display_name: string } | null;
    services: Array<{ services: { name: string; duration_min: number } | null }> | null;
  };
  const upcoming = ((upcomingRes.data as UpcomingRow[] | null) ?? []).map((r) => {
    // Plan 044 (UX-03) — per-appointment refund cutoff, computed with the
    // SAME resolver + formula as the cancel action (start - mins; mins 0 =
    // no window, always refundable → null cutoff).
    const resolved = resolveEffectiveBarberSettings(settingsRows, r.barber_id);
    const minsBefore = resolved.mins_cancel_before_appt;
    const refundCutoffAt =
      minsBefore > 0
        ? new Date(new Date(r.start_at).getTime() - minsBefore * 60_000).toISOString()
        : null;
    return {
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
      // Plan 044 (DIRECTION-01) — FRESH per-render tokens (pure HMAC signs,
      // no DB write), same kinds/TTLs as actions-public-links.ts. /me always
      // offers a LIVE reschedule link even when the emailed 7-day one died.
      rescheduleToken: signToken({
        kind: 'reschedule',
        resourceId: r.id,
        expiresInSeconds: 60 * 60 * 24 * 7,
        ver: r.public_link_version ?? 0,
      }),
      receiptToken: signToken({
        kind: 'receipt',
        resourceId: r.id,
        expiresInSeconds: 60 * 60 * 24 * 365,
        ver: r.public_link_version ?? 0,
      }),
      refundCutoffAt,
      depositCents: r.deposit_amount_cents ?? 0,
    };
  });

  // Plan 037 (CORRECTNESS-02) — the hero displayed the RAW balance, expired
  // credit included ("10,00 $ — appliqué automatiquement" for credit the
  // booking flow would never apply). Route through the same effective-balance
  // helper the booking path uses: returns 0 when expired and lazily zeroes
  // the row so subsequent reads agree.
  const effectiveLoyaltyCents = await effectiveLoyaltyBalanceCents({
    clientId: client.id,
    balanceCents: client.loyalty_balance_cents ?? 0,
    expiresAt: client.loyalty_balance_expires_at ?? null,
  });

  return (
    <MeClient
      locale={locale}
      token={token}
      client={{
        firstName: client.first_name,
        loyaltyBalanceCents: effectiveLoyaltyCents,
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
