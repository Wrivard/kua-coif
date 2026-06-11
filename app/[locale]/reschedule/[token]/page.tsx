import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { verifyToken } from '@/lib/security/signed-tokens';
import { RescheduleClient } from './reschedule-client';

export const dynamic = 'force-dynamic';

/**
 * Phase 74 — Customer self-service reschedule.
 *
 * Reached via a signed token (kind='reschedule', 7-day TTL). The
 * customer sees their current appointment + a date strip to pick a new
 * day. Time slots are loaded client-side from /api/book/[shopSlug]/slots
 * (same endpoint used by the booking wizard step 3). On submit, the
 * `reschedulePublicAppointment` server action validates the token,
 * checks availability, and updates the row.
 */
export default async function ReschedulePage(props: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const params = await props.params;

  const { locale, token } = params;

  setRequestLocale(locale);

  const payload = verifyToken(decodeURIComponent(token), 'reschedule');
  if (!payload) notFound();

  const supabase = createSupabaseServiceRoleClient();

  const apptRes = await supabase
    .from('appointments')
    .select(
      `id, start_at, end_at, status, barber_id, client_name_snapshot, public_link_version,
       shop:shops(id, name, alias, timezone),
       barber:barbers(display_name)`,
    )
    .eq('id', payload.resourceId)
    .limit(1);
  const appt = (apptRes.data ?? [])[0];
  // `alias` is nullable in the schema; a shop without one has no public
  // booking surface, so its reschedule page 404s like a bad token.
  if (!appt || !appt.shop?.alias) notFound();
  // Revocation (plan 013): stale token version → 404, same as a bad/expired
  // token. Absent ⇒ 0 keeps legacy links valid until the first revoke.
  if ((payload.ver ?? 0) !== (appt.public_link_version ?? 0)) notFound();

  // Block reschedule on terminal-status appointments (UX nicety —
  // the action would refuse anyway, but rendering the form is
  // misleading).
  const isTerminal = ['cancelled', 'no_show', 'completed'].includes(appt.status);

  const durationMin = Math.round(
    (new Date(appt.end_at).getTime() - new Date(appt.start_at).getTime()) / 60000,
  );

  return (
    <RescheduleClient
      locale={locale}
      token={token}
      isTerminal={isTerminal}
      appointment={{
        id: appt.id,
        startAt: appt.start_at,
        endAt: appt.end_at,
        durationMin,
        barberId: appt.barber_id,
        barberName: appt.barber?.display_name ?? '·',
        clientName: appt.client_name_snapshot,
      }}
      shop={{
        slug: appt.shop.alias,
        name: appt.shop.name,
        timezone: appt.shop.timezone,
      }}
    />
  );
}
