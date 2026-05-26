'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { err, ok, type Result } from '@/lib/server-actions/result';
import { captureException } from '@/lib/observability';
import { logAuditAction } from '@/lib/audit-log';
import { verifyToken } from '@/lib/security/signed-tokens';
import { combineShopDateTime, shopDayStart, shopDayEnd } from '@/lib/business/timezone';
import { checkAvailability, type ExistingAppointment } from '@/lib/business/availability';

/**
 * Phase 74 — Public reschedule via signed token.
 *
 * Mirrors the admin reschedule logic (drag-drop in the calendar) but
 * gated by a signed token (kind='reschedule', resourceId=appointment_id)
 * with a 7-day TTL. The customer can move their appointment within
 * the same shop / barber / services; date+time are the only changes.
 */

const schema = z.object({
  token: z.string().trim().min(10).max(4096),
  new_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  new_start_time: z.string().regex(/^\d{2}:\d{2}$/),
});

export type ReschedulePublicInput = z.infer<typeof schema>;

function clientIp(): string {
  const h = headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown';
}

function toMinutes(t: string): number {
  const [hh, mm] = t.split(':').map(Number);
  return (hh ?? 0) * 60 + (mm ?? 0);
}

function formatMinutes(m: number): string {
  const h = Math.floor((m % 1440) / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export async function reschedulePublicAppointment(
  raw: ReschedulePublicInput,
): Promise<Result<{ id: string }>> {
  try {
    const ip = clientIp();
    const rl = await checkRateLimit(`reschedule:${ip}`, {
      max: 15,
      windowMs: 10 * 60 * 1000,
    });
    if (!rl.allowed) return err('RATE_LIMITED');

    const parsed = schema.safeParse(raw);
    if (!parsed.success) return err('INVALID_INPUT');
    const input = parsed.data;

    const payload = verifyToken(input.token, 'reschedule');
    if (!payload) return err('INVALID_INPUT');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createSupabaseServiceRoleClient() as any;

    // Resolve appointment + shop + total duration in one go.
    const apptRes = await supabase
      .from('appointments')
      .select('id, shop_id, barber_id, start_at, end_at, status, shop:shops(id, timezone)')
      .eq('id', payload.resourceId)
      .limit(1);
    const appt = ((apptRes.data as Array<{
      id: string;
      shop_id: string;
      barber_id: string;
      start_at: string;
      end_at: string;
      status: string;
      shop: { id: string; timezone: string } | null;
    }> | null) ?? [])[0];
    if (!appt || !appt.shop) return err('NOT_FOUND');

    // Block reschedules on terminal-status appointments.
    if (['cancelled', 'no_show', 'completed'].includes(appt.status)) {
      return err('INVALID_INPUT');
    }

    // Original duration is preserved — customers don't change services
    // via the public reschedule flow (that's an admin-only operation).
    const originalDurationMin = Math.round(
      (new Date(appt.end_at).getTime() - new Date(appt.start_at).getTime()) / 60000,
    );

    const newStartAt = combineShopDateTime(
      input.new_date,
      input.new_start_time,
      appt.shop.timezone,
    );
    const newEndAt = new Date(newStartAt.getTime() + originalDurationMin * 60_000);

    // Availability check against the new slot — same logic as
    // bookPublicAppointment but excluding the appointment we're moving.
    const dayStart = shopDayStart(newStartAt, appt.shop.timezone);
    const dayEnd = shopDayEnd(newStartAt, appt.shop.timezone);
    const [hoursRes, daysOffRes, apptsRes, blockedRes, settingsRes] = await Promise.all([
      supabase
        .from('shop_hours')
        .select('weekday, enabled, open_time, close_time')
        .eq('shop_id', appt.shop_id),
      supabase.from('shop_days_off').select('date').eq('shop_id', appt.shop_id),
      supabase
        .from('appointments')
        .select('id, barber_id, start_at, end_at, status')
        .eq('shop_id', appt.shop_id)
        .neq('id', appt.id) // exclude self
        .gte('start_at', dayStart.toISOString())
        .lt('start_at', dayEnd.toISOString()),
      supabase
        .from('blocked_time')
        .select('barber_id, start_at, end_at')
        .eq('shop_id', appt.shop_id)
        .gte('start_at', dayStart.toISOString())
        .lt('start_at', dayEnd.toISOString()),
      supabase
        .from('barber_settings')
        .select(
          'scope, barber_id, client_booking_interval_min, days_book_in_advance, mins_book_before_appt',
        )
        .eq('shop_id', appt.shop_id),
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
    const settings =
      settingsRows.find((r) => r.scope === 'barber' && r.barber_id === appt.barber_id) ??
      settingsRows.find((r) => r.scope === 'shop') ??
      null;
    const shopWeekday = new Date(`${input.new_date}T00:00:00`).getDay();
    const verdict = checkAvailability({
      start_at: newStartAt,
      end_at: newEndAt,
      barber_id: appt.barber_id,
      shop_date: input.new_date,
      shop_weekday: shopWeekday,
      shop_start_time: input.new_start_time,
      shop_end_time: formatMinutes(toMinutes(input.new_start_time) + originalDurationMin),
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
    if (!verdict.ok) {
      return err(
        verdict.reason === 'CONFLICT_APPOINTMENT' || verdict.reason === 'CONFLICT_BLOCK'
          ? 'CONFLICT'
          : 'INVALID_INPUT',
      );
    }

    const { error } = await supabase
      .from('appointments')
      .update({
        start_at: newStartAt.toISOString(),
        end_at: newEndAt.toISOString(),
      })
      .eq('id', appt.id);
    if (error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: appt.shop_id,
      actorId: '00000000-0000-0000-0000-000000000000',
      action: 'update',
      entity: 'appointments',
      entityId: appt.id,
      diff: {
        source: 'public-reschedule',
        old_start_at: appt.start_at,
        new_start_at: newStartAt.toISOString(),
      },
    });

    return ok({ id: appt.id });
  } catch (e) {
    captureException(e, { tags: { layer: 'public-reschedule' } });
    return err('UNEXPECTED');
  }
}
