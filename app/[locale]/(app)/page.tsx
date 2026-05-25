import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentShop, requireShopMember } from '@/lib/auth/server';
import { parseShopIsoDate, shopDayEnd, shopIsoDate } from '@/lib/business/timezone';
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
  const [
    barbersRes,
    servicesRes,
    categoriesRes,
    clientsRes,
    hoursRes,
    daysOffRes,
    apptsRes,
    blockedRes,
    apptServicesRes,
  ] = await Promise.all([
    sb.from('barbers').select('*').order('sort_order', { ascending: true }),
    sb.from('services').select('*').order('sort_order', { ascending: true }),
    sb.from('service_categories').select('*').order('sort_order', { ascending: true }),
    sb
      .from('clients')
      .select('id, first_name, last_name, email, phone')
      .order('first_name', { ascending: true }),
    sb
      .from('shop_hours')
      .select('weekday, enabled, open_time, close_time')
      .order('weekday', { ascending: true }),
    sb.from('shop_days_off').select('date').order('date', { ascending: true }),
    sb
      .from('appointments')
      .select('id, barber_id, client_id, start_at, end_at, status, notes, source, total_amount')
      .order('start_at', { ascending: true })
      // Filter by start_at within the day in UTC bounds. We use gte/lt via the chained builder.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .gte('start_at' as any, dayStart.toISOString())
      .lt('start_at', dayEnd.toISOString()),
    sb
      .from('blocked_time')
      .select('id, barber_id, start_at, end_at, reason')
      .order('start_at', { ascending: true })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .gte('start_at' as any, dayStart.toISOString())
      .lt('start_at', dayEnd.toISOString()),
    sb
      .from('appointment_services')
      .select('appointment_id, service_id, price_snapshot')
      .order('appointment_id', { ascending: true }),
  ]);

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
  }));

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
    />
  );
}
