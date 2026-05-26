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
export default async function ReschedulePage({
  params: { locale, token },
}: {
  params: { locale: string; token: string };
}) {
  setRequestLocale(locale);

  const payload = verifyToken(decodeURIComponent(token), 'reschedule');
  if (!payload) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServiceRoleClient() as any;

  const apptRes = await supabase
    .from('appointments')
    .select(
      `id, start_at, end_at, status, barber_id, client_name_snapshot,
       shop:shops(id, name, alias, timezone),
       barber:barbers(display_name)`,
    )
    .eq('id', payload.resourceId)
    .limit(1);
  const appt = ((apptRes.data as Array<{
    id: string;
    start_at: string;
    end_at: string;
    status: string;
    barber_id: string;
    client_name_snapshot: string | null;
    shop: { id: string; name: string; alias: string; timezone: string } | null;
    barber: { display_name: string } | null;
  }> | null) ?? [])[0];
  if (!appt || !appt.shop) notFound();

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
        barberName: appt.barber?.display_name ?? '—',
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
