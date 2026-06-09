import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  getCurrentBarberId,
  getCurrentShop,
  getCurrentShopId,
  getShopMemberships,
  requireShopMember,
} from '@/lib/auth/server';
import {
  addDays,
  formatShopTime,
  parseShopIsoDate,
  shopDayEnd,
  shopIsoDate,
} from '@/lib/business/timezone';
import { googleConfigured } from '@/lib/google/server';
import { fetchBarberBusyForDay } from '@/lib/google/sync';
import type { BarberRow, ClientRow, ServiceRow } from '@/db/rows';
import {
  getCachedServiceCategories,
  getCachedServices,
  getCachedShopDaysOff,
  getCachedShopHours,
} from '@/lib/data/calendar-config';
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
  // Isolation — resolve the ACTIVE shop (cookie-aware), not memberships[0].
  // A multi-shop user (owner in A, barber in B) must get shop B's role +
  // data; and every query below is EXPLICITLY scoped to `shopId` rather than
  // leaning on is_shop_member RLS, which spans ALL of the user's shops (that
  // would render a merged cross-shop calendar for multi-shop members).
  const memberships = await getShopMemberships();
  const activeShopId = await getCurrentShopId();
  const activeMembership = memberships.find((m) => m.shop_id === activeShopId) ?? memberships[0];
  const shopId = activeMembership?.shop_id ?? activeShopId;
  // `requireShopMember` above guarantees the viewer belongs to a shop, so
  // shopId is non-null in practice; narrow it for the typed cache loaders
  // (and treat the unreachable null as a load failure → error.tsx).
  if (!shopId) throw new Error('Calendar load failed: no active shop resolved');
  const viewerRole = activeMembership?.role ?? 'barber';
  const viewerBarberId = viewerRole === 'barber' ? await getCurrentBarberId() : null;
  const isStrictBarber = viewerRole === 'barber' && Boolean(viewerBarberId);

  const sb = createSupabaseServerClient();

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
  // Seed the calendar view from `?view=`. `list` and `week` override the
  // Side-by-Side default. Side-by-side and list share the same day-scoped
  // dataset; `week` additionally pulls the full week range below.
  const initialView =
    searchParams.view === 'list' ? 'list' : searchParams.view === 'week' ? 'week' : 'side-by-side';

  // Week view needs the Mon..Sun week containing the selected date. Derive
  // Monday from the shop-local ISO weekday (1=Mon … 7=Sun), then build the
  // 7 shop-local ISO dates and the UTC range that spans them.
  const isoWeekday = Number(formatShopTime(dayStart, timezone, 'i')); // 1..7
  const weekMondayIso = shopIsoDate(addDays(dayStart, -(isoWeekday - 1)), timezone);
  const weekDays: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    weekDays.push(shopIsoDate(addDays(parseShopIsoDate(weekMondayIso, timezone), i), timezone));
  }
  const weekStart = parseShopIsoDate(weekMondayIso, timezone);
  const weekEnd = shopDayEnd(parseShopIsoDate(weekDays[6]!, timezone), timezone);

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
        .eq('shop_id', shopId)
        // isStrictBarber guarantees viewerBarberId is non-null (see its
        // definition); TS can't narrow across the two variables.
        .eq('id', viewerBarberId!)
        .order('sort_order', { ascending: true })
    : sb.from('barbers').select('*').eq('shop_id', shopId).order('sort_order', { ascending: true });

  const apptsQuery = (
    isStrictBarber
      ? sb
          .from('appointments')
          .select(
            'id, barber_id, client_id, start_at, end_at, status, notes, source, total_amount, payment_status',
          )
          .eq('barber_id', viewerBarberId!)
      : sb
          .from('appointments')
          .select(
            'id, barber_id, client_id, start_at, end_at, status, notes, source, total_amount, payment_status',
          )
  )
    .eq('shop_id', shopId)
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
    .eq('shop_id', shopId)
    .order('start_at', { ascending: true })
    .gte('start_at', dayStart.toISOString())
    .lt('start_at', dayEnd.toISOString());

  // Slow-changing, shop-UNIFORM config (services / categories / hours /
  // days-off) is served from the cross-request Data Cache — see
  // lib/data/calendar-config. These re-run on every load AND every Realtime
  // refresh yet change a few times a week, so caching removes 4 Postgres
  // round-trips from the hot path. The per-viewer, time-sensitive reads
  // (barbers, clients, appointments, blocked_time) stay on the live RLS
  // client.
  const [barbersRes, clientsRes, apptsRes, blockedRes, services, categories, hours, daysOff] =
    await Promise.all([
      barbersQuery,
      sb
        .from('clients')
        .select('id, first_name, last_name, email, phone')
        .eq('shop_id', shopId)
        .order('first_name', { ascending: true })
        .limit(500),
      apptsQuery,
      blockedQuery,
      getCachedServices(shopId),
      getCachedServiceCategories(shopId),
      getCachedShopHours(shopId),
      getCachedShopDaysOff(shopId),
    ]);

  // Reliability — a failed load-bearing read must NOT render as an empty-but-
  // valid calendar (the operator would silently miss real bookings on the
  // route they watch all day). Throw so the (app)/error.tsx boundary catches
  // it and Sentry fires. Reference lists (categories/clients) degrade to empty
  // without throwing — a missing client picker is recoverable; a missing
  // appointment is not. Hours/days-off now flow through the cached loaders,
  // which degrade to [] on a read error (open-fallback grid, no day-off
  // shading) rather than throwing — neither can cause a missed appointment.
  const loadError = barbersRes.error || apptsRes.error || blockedRes.error;
  if (loadError) {
    throw new Error(
      `Calendar load failed: ${(loadError as { message?: string }).message ?? loadError}`,
    );
  }

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
  if ((apptServicesRes as { error?: unknown }).error) {
    throw new Error('Calendar load failed: appointment_services read error');
  }

  const barbers = ((barbersRes.data as BarberRow[] | null) ?? []).filter(
    (b) => b.status === 'confirmed',
  );
  // services / categories / hours / daysOff come back already typed from the
  // cached loaders above; only clients still needs unwrapping from its res.
  const clients = (clientsRes.data as ClientRow[] | null) ?? [];
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
      if (!c) return '·';
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

  // ── Week view dataset ─────────────────────────────────────────────────
  // Only fetched when `?view=week`; Side-by-Side and List keep the
  // day-scoped `appointments` above untouched. Mirrors the day query
  // (same columns, same strict-barber scope) but spans the Mon..Sun
  // range, then re-uses the service/client maps to build the same
  // CalendarAppointment shape.
  let weekAppointments: CalendarAppointment[] = [];
  if (initialView === 'week') {
    const weekApptsQuery = (
      isStrictBarber
        ? sb
            .from('appointments')
            .select(
              'id, barber_id, client_id, start_at, end_at, status, notes, source, total_amount, payment_status',
            )
            .eq('barber_id', viewerBarberId!)
        : sb
            .from('appointments')
            .select(
              'id, barber_id, client_id, start_at, end_at, status, notes, source, total_amount, payment_status',
            )
    )
      .eq('shop_id', shopId)
      .order('start_at', { ascending: true })
      .gte('start_at', weekStart.toISOString())
      .lt('start_at', weekEnd.toISOString());

    const weekApptsRes = await weekApptsQuery;
    // Same load-bearing reliability rule as the day path (lines above): a
    // failed week read must NOT render as an empty-but-valid week (the
    // operator would silently miss real bookings). Throw → (app)/error.tsx.
    if (weekApptsRes.error) {
      throw new Error(
        `Calendar week load failed: ${(weekApptsRes.error as { message?: string }).message ?? weekApptsRes.error}`,
      );
    }
    const weekRows =
      (weekApptsRes.data as Array<{
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

    const weekApptIds = weekRows.map((r) => r.id);
    const weekServicesRes =
      weekApptIds.length > 0
        ? await sb
            .from('appointment_services')
            .select('appointment_id, service_id, price_snapshot')
            .in('appointment_id', weekApptIds)
        : { data: [] as Array<unknown> };
    if ((weekServicesRes as { error?: unknown }).error) {
      throw new Error('Calendar week load failed: appointment_services read error');
    }
    const weekServiceLinks =
      (weekServicesRes.data as Array<{
        appointment_id: string;
        service_id: string;
        price_snapshot: number;
      }> | null) ?? [];
    const weekServicesByAppt = new Map<string, ServiceRow[]>();
    for (const link of weekServiceLinks) {
      const list = weekServicesByAppt.get(link.appointment_id) ?? [];
      const svc = serviceById.get(link.service_id);
      if (svc) list.push(svc);
      weekServicesByAppt.set(link.appointment_id, list);
    }

    weekAppointments = weekRows.map((a) => ({
      id: a.id,
      barber_id: a.barber_id,
      client_id: a.client_id,
      client_name: (() => {
        const c = clientById.get(a.client_id);
        if (!c) return '·';
        return `${c.first_name}${c.last_name ? ` ${c.last_name}` : ''}`;
      })(),
      start_at: a.start_at,
      end_at: a.end_at,
      status: a.status,
      notes: a.notes,
      source: a.source,
      total_amount: a.total_amount,
      services: weekServicesByAppt.get(a.id) ?? [],
      payment_status: a.payment_status,
    }));
  }

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
        // Bound each Google call: one hung/slow connection must NOT wall the
        // home-route render. After 1.5s we drop that barber's overlay (the
        // grid is still fully usable — the busy overlay is decorative). The
        // timer is cleared once the race settles so the losing branch doesn't
        // leave a pending timeout behind for each barber.
        periods: await (async () => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            return await Promise.race([
              fetchBarberBusyForDay(b.id, dayStart, dayEnd),
              new Promise<Array<{ start: string; end: string }>>((resolve) => {
                timer = setTimeout(() => resolve([]), 1500);
              }),
            ]);
          } finally {
            if (timer) clearTimeout(timer);
          }
        })(),
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
      canManageMoney={viewerRole !== 'barber'}
      timezone={timezone}
      isoDate={isoDate}
      initialView={initialView}
      barbers={barbers}
      services={services}
      categories={categories}
      clients={clients}
      hours={hours}
      daysOff={daysOff}
      appointments={appointments}
      weekAppointments={weekAppointments}
      weekDays={weekDays}
      blocked={blocked}
      googleBusy={googleBusy}
      onboarding={onboarding}
    />
  );
}
