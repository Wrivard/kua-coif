import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  getCurrentBarberId,
  getCurrentShop,
  getShopMemberships,
  requireShopMember,
} from '@/lib/auth/server';
import { parseShopIsoDate, shopDayEnd, shopIsoDate } from '@/lib/business/timezone';
import { googleConfigured } from '@/lib/google/server';
import { fetchBarberBusyForDay } from '@/lib/google/sync';
import type { BarberRow, ClientRow, ServiceCategoryRow, ServiceRow } from '@/db/rows';
import { AppointmentsCalendar, type CalendarAppointment } from './appointments-calendar';

export const dynamic = 'force-dynamic';

type Props = {
  params: { locale: string };
  searchParams: { date?: string; view?: string };
};

export default async function AppointmentsPage({ params: { locale }, searchParams }: Props) {
  setRequestLocale(locale);
  await requireShopMember({ locale });

  // Phase H+5 — strict barber scope on reads. If the viewer is a
  // barber (not owner/manager), narrow every list query down to:
  //   - their OWN barber row (calendar only renders their column)
  //   - their OWN appointments
  //   - their OWN blocked_time (+ shop-wide blocks where barber_id is null)
  //   - clients they've actually served
  // Owners and managers keep full visibility.
  const memberships = await getShopMemberships();
  const viewerRole = memberships[0]?.role ?? 'barber';
  const viewerBarberId = viewerRole === 'barber' ? await getCurrentBarberId() : null;
  const isStrictBarber = viewerRole === 'barber' && Boolean(viewerBarberId);

  const supabase = createSupabaseServerClient();
  // Until db/types codegen lands, we cast the chainable Supabase builder to a
  // permissive type. The real client returns the correct shape at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // 1. Resolve shop timezone. `getCurrentShop()` is the React-cached read
  //    of the shops row — the layout already called this same helper on
  //    its way down, so this returns instantly from cache rather than
  //    hitting Postgres again.
  const shop = await getCurrentShop();
  const timezone = shop?.timezone ?? 'America/Toronto';

  // 2. Pick the day to render. `?date=YYYY-MM-DD` or today (in shop tz).
  const today = shopIsoDate(new Date(), timezone);
  const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? '') ? searchParams.date! : today;
  const dayStart = parseShopIsoDate(isoDate, timezone);
  const dayEnd = shopDayEnd(dayStart, timezone);

  // 3. Fetch barbers, services, categories, clients, hours, days off, appts, blocked.
  //
  // Perf notes (Phase 29 deep-dive):
  //  - `clients` is capped at 500. Mega-shops (1000+ clients) would otherwise
  //    transfer ~100KB of JSON just to populate the form modal's client picker.
  //    The cap covers every shop currently on the platform; long-tail clients
  //    surface via search-as-you-type (V1.2 — Server Action lookup).
  //  - `appointment_services` was UNFILTERED — grew linearly with total
  //    appointments in the shop forever. Now scoped to today's appointment IDs
  //    via a sub-query (`.in('appointment_id', ...)`), keeping the payload to
  //    O(today's appointments × 1-2 services each) ≈ <100 rows even on a
  //    busy day.
  //
  // The appointment_services query depends on appointments, so we resolve
  // appointments first then run the linked-services query in parallel with
  // everything else. Two phases of parallelism.
  // Phase H+5 — build the barber + appointment queries conditionally
  // based on viewer role. For a strict barber, narrow to their row
  // only; for managers + owners, keep the original "all" queries.
  const barbersQuery = isStrictBarber
    ? sb
        .from('barbers')
        .select('*')
        .eq('id', viewerBarberId)
        .order('sort_order', { ascending: true })
    : sb.from('barbers').select('*').order('sort_order', { ascending: true });

  const apptsQuery = (
    isStrictBarber
      ? sb
          .from('appointments')
          .select(
            'id, barber_id, client_id, start_at, end_at, status, notes, source, total_amount, payment_status',
          )
          .eq('barber_id', viewerBarberId)
      : sb
          .from('appointments')
          .select(
            'id, barber_id, client_id, start_at, end_at, status, notes, source, total_amount, payment_status',
          )
  )
    .order('start_at', { ascending: true })
    .gte('start_at', dayStart.toISOString())
    .lt('start_at', dayEnd.toISOString());

  // Blocked time: a strict barber sees their personal blocks PLUS
  // shop-wide blocks (barber_id IS NULL). PostgREST `or()` covers it.
  const blockedQuery = (
    isStrictBarber
      ? sb
          .from('blocked_time')
          .select('id, barber_id, start_at, end_at, reason')
          .or(`barber_id.eq.${viewerBarberId},barber_id.is.null`)
      : sb.from('blocked_time').select('id, barber_id, start_at, end_at, reason')
  )
    .order('start_at', { ascending: true })
    .gte('start_at', dayStart.toISOString())
    .lt('start_at', dayEnd.toISOString());

  const [
    barbersRes,
    servicesRes,
    categoriesRes,
    clientsRes,
    hoursRes,
    daysOffRes,
    apptsRes,
    blockedRes,
  ] = await Promise.all([
    barbersQuery,
    sb.from('services').select('*').order('sort_order', { ascending: true }),
    sb.from('service_categories').select('*').order('sort_order', { ascending: true }),
    sb
      .from('clients')
      .select('id, first_name, last_name, email, phone')
      .order('first_name', { ascending: true })
      .limit(500),
    sb
      .from('shop_hours')
      .select('weekday, enabled, open_time, close_time')
      .order('weekday', { ascending: true }),
    sb.from('shop_days_off').select('date').order('date', { ascending: true }),
    apptsQuery,
    blockedQuery,
  ]);

  // Phase 2 of parallelism: now that we know which appointments exist today,
  // fetch ONLY their service links. Empty IDs short-circuits to no query at all.
  const todayApptIds = ((apptsRes.data as Array<{ id: string }> | null) ?? []).map((r) => r.id);
  const apptServicesRes =
    todayApptIds.length > 0
      ? await sb
          .from('appointment_services')
          .select('appointment_id, service_id, price_snapshot')
          .in('appointment_id', todayApptIds)
      : { data: [] as Array<unknown> };

  const barbers = ((barbersRes.data as BarberRow[] | null) ?? []).filter(
    (b) => b.status === 'confirmed',
  );
  const services = (servicesRes.data as ServiceRow[] | null) ?? [];
  const categories = (categoriesRes.data as ServiceCategoryRow[] | null) ?? [];
  const clients = (clientsRes.data as ClientRow[] | null) ?? [];
  const hours =
    (hoursRes.data as Array<{
      weekday: number;
      enabled: boolean;
      open_time: string | null;
      close_time: string | null;
    }> | null) ?? [];
  const daysOff = ((daysOffRes.data as Array<{ date: string }> | null) ?? []).map((d) => d.date);
  const apptRows =
    (apptsRes.data as Array<{
      id: string;
      barber_id: string;
      client_id: string;
      start_at: string;
      end_at: string;
      status: CalendarAppointment['status'];
      notes: string | null;
      source: 'admin' | 'online';
      total_amount: number;
      payment_status: CalendarAppointment['payment_status'];
    }> | null) ?? [];
  const blocked =
    (blockedRes.data as Array<{
      id: string;
      barber_id: string | null;
      start_at: string;
      end_at: string;
      reason: string | null;
    }> | null) ?? [];
  const apptServiceLinks =
    (apptServicesRes.data as Array<{
      appointment_id: string;
      service_id: string;
      price_snapshot: number;
    }> | null) ?? [];

  // Pivot appointment_services into appointment_id → service rows.
  const servicesByAppt = new Map<string, ServiceRow[]>();
  const serviceById = new Map(services.map((s) => [s.id, s]));
  for (const link of apptServiceLinks) {
    const list = servicesByAppt.get(link.appointment_id) ?? [];
    const svc = serviceById.get(link.service_id);
    if (svc) list.push(svc);
    servicesByAppt.set(link.appointment_id, list);
  }
  const clientById = new Map(clients.map((c) => [c.id, c]));

  const appointments: CalendarAppointment[] = apptRows.map((a) => ({
    id: a.id,
    barber_id: a.barber_id,
    client_id: a.client_id,
    client_name: (() => {
      const c = clientById.get(a.client_id);
      if (!c) return '—';
      return `${c.first_name}${c.last_name ? ` ${c.last_name}` : ''}`;
    })(),
    start_at: a.start_at,
    end_at: a.end_at,
    status: a.status,
    notes: a.notes,
    source: a.source,
    total_amount: a.total_amount,
    services: servicesByAppt.get(a.id) ?? [],
    payment_status: a.payment_status,
  }));

  // ── Google Calendar busy overlays (Phase 34) ──────────────────────────
  // For each confirmed barber, ask their connected Google account for
  // busy periods in today's window. unstable_cache (60s TTL) means most
  // navigations hit the cache. Empty array when Google is not configured
  // or the barber hasn't connected. Parallel so the slowest barber gates
  // the worst case.
  const googleBusy: Array<{
    barberId: string;
    periods: Array<{ start: string; end: string }>;
  }> = [];
  if (googleConfigured()) {
    const results = await Promise.all(
      barbers.map(async (b) => ({
        barberId: b.id,
        periods: await fetchBarberBusyForDay(b.id, dayStart, dayEnd),
      })),
    );
    for (const r of results) {
      if (r.periods.length > 0) googleBusy.push(r);
    }
  }

  // Phase 45 — onboarding hint signals. Each is a cheap boolean derived
  // from data we already fetched. The OnboardingCard auto-hides when
  // every step is complete, so a fully-setup shop sees nothing.
  const shopAddressFilled = Boolean(
    (shop as { id: string; street?: string | null } | null)?.street,
  );
  const hoursConfigured = hours.some((h) => h.enabled);
  const onboarding = {
    shopAddressFilled,
    hoursConfigured,
    servicesCount: services.length,
    barbersCount: barbers.length,
  };

  return (
    <AppointmentsCalendar
      locale={locale}
      timezone={timezone}
      isoDate={isoDate}
      barbers={barbers}
      services={services}
      categories={categories}
      clients={clients}
      hours={hours}
      daysOff={daysOff}
      appointments={appointments}
      blocked={blocked}
      googleBusy={googleBusy}
      onboarding={onboarding}
    />
  );
}
