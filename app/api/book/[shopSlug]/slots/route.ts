import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { combineShopDateTime, shopDayEnd, shopDayStart } from '@/lib/business/timezone';
import { checkAvailability, type ExistingAppointment } from '@/lib/business/availability';
import { resolveEffectiveBarberSettings } from '@/lib/business/barber-settings';
import {
  getCachedShopByAlias,
  getCachedBookableBarbers,
  getCachedShopHours,
  getCachedShopDaysOff,
  getCachedBarberSettings,
} from '@/lib/data/calendar-config';
import { getClientIp } from '@/lib/security/client-ip';

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
  const ip = getClientIp(req.headers);
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

  // Resolve shop. Slow-changing config (shop projection, bookable barbers,
  // hours, days-off, barber_settings) comes from the per-shop Data Cache
  // (lib/data/calendar-config) — those tables change a few times a week and
  // every mutating action busts their tag. Only appointments + blocked_time
  // stay LIVE below (they're volatile by the minute). The response itself
  // remains `no-store` so the wizard always recomputes against fresh bookings.
  const shop = await getCachedShopByAlias(params.shopSlug);
  if (!shop) return NextResponse.json({ slots: [] }, { status: 404 });

  // Resolve target barber (or "first confirmed bookable" if 'any') against the
  // cached confirmed+bookable list (B6/B17) — same filter the per-call queries
  // used (shop-scoped, status=confirmed, bookable=true, sort_order asc) — so we
  // never surface a hidden / soft-deleted / cross-shop barber. The booking
  // action re-checks live, so a stale list can never become a wrong booking.
  const bookableBarbers = await getCachedBookableBarbers(shop.id);
  let barberId: string | null = null;
  if (barber && barber !== 'any') {
    barberId = bookableBarbers.some((b) => b.id === barber) ? barber : null;
  } else if (shop.allow_booking_any_barber) {
    barberId = bookableBarbers[0]?.id ?? null;
  }
  if (!barberId) return NextResponse.json({ slots: [] });

  // Load the day's schedule. The Promise.all runs exactly TWO live DB queries
  // (appointments, blocked_time); the other three entries resolve from the
  // per-shop Data Cache.
  const dayStart = shopDayStart(new Date(`${date}T12:00:00Z`), shop.timezone);
  const dayEnd = shopDayEnd(dayStart, shop.timezone);
  const [hours, daysOff, settingsRows, apptsRes, blockedRes] = await Promise.all([
    getCachedShopHours(shop.id),
    getCachedShopDaysOff(shop.id),
    getCachedBarberSettings(shop.id),
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
  ]);

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
  // B20 — shared resolver (override → shop → defaults). Never null now.
  const settings = resolveEffectiveBarberSettings(settingsRows, barberId);
  const interval = settings.client_booking_interval_min;

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
      settings: {
        client_booking_interval_min: settings.client_booking_interval_min,
        days_book_in_advance: settings.days_book_in_advance,
        mins_book_before_appt: settings.mins_book_before_appt,
      },
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
