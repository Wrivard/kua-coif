import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { combineShopDateTime, shopDayEnd, shopDayStart } from '@/lib/business/timezone';
import { checkAvailability, type ExistingAppointment } from '@/lib/business/availability';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/book/[shopSlug]/slots?date=YYYY-MM-DD&barber=<uuid|any>&duration=<min>
 *
 * Returns the list of bookable start times (HH:mm in shop-local) for the
 * given combination. Iterates the shop's opening interval by the barber's
 * client_booking_interval_min, asks the pure availability engine for each
 * candidate, and keeps the ones it accepts.
 *
 * Public endpoint — rate-limited by IP to keep scraping cheap.
 */
export async function GET(req: NextRequest, { params }: { params: { shopSlug: string } }) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rl = await checkRateLimit(`slots:${ip}`, { max: 30, windowMs: 60 * 1000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  }

  const date = req.nextUrl.searchParams.get('date');
  const barber = req.nextUrl.searchParams.get('barber');
  const durationParam = req.nextUrl.searchParams.get('duration');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'INVALID_DATE' }, { status: 400 });
  }
  const duration = Number(durationParam);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 8 * 60) {
    return NextResponse.json({ error: 'INVALID_DURATION' }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServiceRoleClient() as any;

  // Resolve shop.
  const shopRes = await supabase
    .from('shops')
    .select('id, timezone, allow_booking_any_barber')
    .eq('alias', params.shopSlug)
    .limit(1);
  const shop = ((shopRes.data as Array<{
    id: string;
    timezone: string;
    allow_booking_any_barber: boolean;
  }> | null) ?? [])[0];
  if (!shop) return NextResponse.json({ slots: [] }, { status: 404 });

  // Resolve target barber (or "first confirmed" if 'any').
  let barberId: string | null = null;
  if (barber && barber !== 'any') {
    barberId = barber;
  } else if (shop.allow_booking_any_barber) {
    const anyRes = await supabase
      .from('barbers')
      .select('id, sort_order')
      .eq('shop_id', shop.id)
      .eq('status', 'confirmed')
      .order('sort_order', { ascending: true })
      .limit(1);
    barberId = ((anyRes.data as Array<{ id: string }> | null) ?? [])[0]?.id ?? null;
  }
  if (!barberId) return NextResponse.json({ slots: [] });

  // Load the day's schedule.
  const dayStart = shopDayStart(new Date(`${date}T12:00:00Z`), shop.timezone);
  const dayEnd = shopDayEnd(dayStart, shop.timezone);
  const [hoursRes, daysOffRes, apptsRes, blockedRes, settingsRes] = await Promise.all([
    supabase
      .from('shop_hours')
      .select('weekday, enabled, open_time, close_time')
      .eq('shop_id', shop.id),
    supabase.from('shop_days_off').select('date').eq('shop_id', shop.id),
    supabase
      .from('appointments')
      .select('id, barber_id, start_at, end_at, status')
      .eq('shop_id', shop.id)
      .gte('start_at', dayStart.toISOString())
      .lt('start_at', dayEnd.toISOString()),
    supabase
      .from('blocked_time')
      .select('barber_id, start_at, end_at')
      .eq('shop_id', shop.id)
      .gte('start_at', dayStart.toISOString())
      .lt('start_at', dayEnd.toISOString()),
    supabase
      .from('barber_settings')
      .select(
        'scope, barber_id, client_booking_interval_min, days_book_in_advance, mins_book_before_appt',
      )
      .eq('shop_id', shop.id),
  ]);

  const hours =
    (hoursRes.data as Array<{
      weekday: number;
      enabled: boolean;
      open_time: string | null;
      close_time: string | null;
    }> | null) ?? [];
  const daysOff = ((daysOffRes.data as Array<{ date: string }> | null) ?? []).map((d) => d.date);
  const existing: ExistingAppointment[] = (
    (apptsRes.data as Array<{
      id: string;
      barber_id: string;
      start_at: string;
      end_at: string;
      status: ExistingAppointment['status'];
    }> | null) ?? []
  ).map((a) => ({
    ...a,
    start_at: new Date(a.start_at),
    end_at: new Date(a.end_at),
  }));
  const blocked = (
    (blockedRes.data as Array<{
      barber_id: string | null;
      start_at: string;
      end_at: string;
    }> | null) ?? []
  ).map((b) => ({
    barber_id: b.barber_id,
    start_at: new Date(b.start_at),
    end_at: new Date(b.end_at),
  }));
  const settingsRows =
    (settingsRes.data as Array<{
      scope: 'shop' | 'barber';
      barber_id: string | null;
      client_booking_interval_min: number;
      days_book_in_advance: number;
      mins_book_before_appt: number;
    }> | null) ?? [];
  const barberOverride = settingsRows.find((r) => r.scope === 'barber' && r.barber_id === barberId);
  const shopDefault = settingsRows.find((r) => r.scope === 'shop');
  const settings = barberOverride ?? shopDefault;
  const interval = settings?.client_booking_interval_min ?? 30;

  // Iterate the day's open window by `interval`, run the engine on each.
  const shopWeekday = new Date(`${date}T00:00:00`).getDay();
  const day = hours.find((h) => h.weekday === shopWeekday);
  if (!day?.enabled || !day.open_time || !day.close_time) {
    return NextResponse.json({ slots: [] });
  }
  const openMin = toMinutes(day.open_time);
  const closeMin = toMinutes(day.close_time);
  const slots: string[] = [];

  for (let m = openMin; m + duration <= closeMin; m += interval) {
    const startTime = formatMinutes(m);
    const endTime = formatMinutes(m + duration);
    const startAt = combineShopDateTime(date, startTime, shop.timezone);
    const endAt = new Date(startAt.getTime() + duration * 60_000);

    const verdict = checkAvailability({
      start_at: startAt,
      end_at: endAt,
      barber_id: barberId,
      shop_date: date,
      shop_weekday: shopWeekday,
      shop_start_time: startTime,
      shop_end_time: endTime,
      hours,
      daysOff: daysOff.map((d) => ({ date: d })),
      existing,
      blocked,
      settings: settings
        ? {
            client_booking_interval_min: settings.client_booking_interval_min,
            days_book_in_advance: settings.days_book_in_advance,
            mins_book_before_appt: settings.mins_book_before_appt,
          }
        : null,
    });
    if (verdict.ok) slots.push(startTime);
  }

  return NextResponse.json(
    { slots, barber_id: barberId, interval },
    { headers: { 'cache-control': 'no-store' } },
  );
}

function toMinutes(t: string): number {
  const [hh, mm] = t.split(':').map(Number);
  return (hh ?? 0) * 60 + (mm ?? 0);
}
function formatMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
